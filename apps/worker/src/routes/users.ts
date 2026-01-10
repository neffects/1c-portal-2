/**
 * User Routes
 * 
 * Handles user management within organizations:
 * - GET / - List users in organization
 * - POST /invite - Invite user to organization
 * - GET /:id - Get user details
 * - PATCH /:id/role - Update user role
 * - DELETE /:id - Remove user from organization
 * - GET /me/preferences - Get current user preferences
 * - PATCH /me/preferences - Update preferences
 * - GET /me/flags - Get flagged entities
 * - POST /me/flags - Flag an entity
 * - DELETE /me/flags/:entityId - Unflag an entity
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { 
  inviteUserRequestSchema, 
  updateUserRoleRequestSchema,
  updateUserPreferencesRequestSchema,
  flagEntityRequestSchema
} from '@1cc/shared';
import { 
  readJSON, writeJSON, deleteFile, listFiles,
  getUserMembershipPath, getOrgProfilePath, getInvitationPath,
  getUserFlagsPath, getUserPreferencesPath, getEntityStubPath
} from '../lib/r2';
import { createUserId, createInvitationToken } from '../lib/id';
import { sendInvitationEmail } from '../lib/email';
import { requireOrgAdmin, requireOrgMembership } from '../middleware/auth';
import { NotFoundError, ConflictError, ForbiddenError, ValidationError } from '../middleware/error';
import { R2_PATHS } from '@1cc/shared';
import type { 
  OrganizationMembership, UserInvitation, UserPreferences, 
  EntityFlag, Organization, EntityStub 
} from '@1cc/shared';

export const userRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /
 * List users in the current user's organization
 */
userRoutes.get('/', async (c) => {
  console.log('[Users] Listing users');
  
  const userRole = c.get('userRole');
  const userOrgId = c.get('organizationId');
  
  if (!userOrgId && userRole !== 'superadmin') {
    return c.json({
      success: true,
      data: { items: [], total: 0 }
    });
  }
  
  // For superadmins, could list all users across orgs
  // For now, require orgId query param
  const orgId = c.req.query('orgId') || userOrgId;
  
  if (!orgId) {
    return c.json({
      success: true,
      data: { items: [], total: 0 }
    });
  }
  
  // Check access
  if (userRole !== 'superadmin' && orgId !== userOrgId) {
    throw new ForbiddenError('You can only view users in your organization');
  }
  
  // List users in organization
  const userFiles = await listFiles(c.env.R2_BUCKET, `${R2_PATHS.PRIVATE}orgs/${orgId}/users/`);
  const jsonFiles = userFiles.filter(f => f.endsWith('.json'));
  
  const items: OrganizationMembership[] = [];
  
  for (const file of jsonFiles) {
    const membership = await readJSON<OrganizationMembership>(c.env.R2_BUCKET, file);
    if (membership) {
      items.push(membership);
    }
  }
  
  // Sort by joinedAt
  items.sort((a, b) => new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime());
  
  console.log('[Users] Found', items.length, 'users in org:', orgId);
  
  return c.json({
    success: true,
    data: {
      items,
      total: items.length
    }
  });
});

/**
 * POST /invite
 * Invite a user to the organization
 */
userRoutes.post('/invite', requireOrgAdmin, async (c) => {
  console.log('[Users] Processing invitation');
  
  const body = await c.req.json();
  const result = inviteUserRequestSchema.safeParse(body);
  
  if (!result.success) {
    throw new ValidationError('Invalid invitation data', { errors: result.error.errors });
  }
  
  const { email, role, note } = result.data;
  const userId = c.get('userId')!;
  const userOrgId = c.get('organizationId');
  
  if (!userOrgId) {
    throw new ForbiddenError('You must belong to an organization to invite users');
  }
  
  // Check if user already exists in org
  const existingUsers = await listFiles(c.env.R2_BUCKET, `${R2_PATHS.PRIVATE}orgs/${userOrgId}/users/`);
  
  for (const file of existingUsers) {
    const membership = await readJSON<OrganizationMembership>(c.env.R2_BUCKET, file);
    if (membership && membership.email.toLowerCase() === email.toLowerCase()) {
      throw new ConflictError('This user is already a member of the organization');
    }
  }
  
  // Get organization details
  const org = await readJSON<Organization>(c.env.R2_BUCKET, getOrgProfilePath(userOrgId));
  
  if (!org) {
    throw new NotFoundError('Organization', userOrgId);
  }
  
  // Create invitation
  const token = createInvitationToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
  
  const invitation: UserInvitation = {
    token,
    email,
    organizationId: userOrgId,
    role,
    invitedBy: userId,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    accepted: false
  };
  
  await writeJSON(c.env.R2_BUCKET, getInvitationPath(token), invitation);
  
  // Build invitation link
  const baseUrl = c.env.API_BASE_URL || 'http://localhost:8787';
  const inviteLink = `${baseUrl}/auth/verify?token=${token}&invite=true`;
  
  // Send invitation email
  if (c.env.RESEND_API_KEY) {
    await sendInvitationEmail(
      c.env.RESEND_API_KEY,
      email,
      inviteLink,
      org.name,
      'A team member' // Could get inviter name
    );
  } else {
    console.log('[Users] DEV MODE - Invitation link:', inviteLink);
  }
  
  console.log('[Users] Invitation sent to:', email);
  
  return c.json({
    success: true,
    data: {
      message: 'Invitation sent successfully',
      email,
      expiresAt: expiresAt.toISOString(),
      ...(c.env.ENVIRONMENT !== 'production' && { devLink: inviteLink })
    }
  }, 201);
});

/**
 * GET /:id
 * Get user details
 */
userRoutes.get('/:id', async (c) => {
  const targetUserId = c.req.param('id');
  const userRole = c.get('userRole');
  const userOrgId = c.get('organizationId');
  const currentUserId = c.get('userId');
  
  console.log('[Users] Getting user:', targetUserId);
  
  // Users can view themselves
  if (targetUserId === currentUserId) {
    // Return current user info
    return c.json({
      success: true,
      data: {
        id: currentUserId,
        role: userRole,
        organizationId: userOrgId
      }
    });
  }
  
  // Need org admin or superadmin to view others
  if (userRole !== 'superadmin' && userRole !== 'org_admin') {
    throw new ForbiddenError('You do not have permission to view other users');
  }
  
  // Search for user in organizations
  if (userOrgId) {
    const membership = await readJSON<OrganizationMembership>(
      c.env.R2_BUCKET,
      getUserMembershipPath(userOrgId, targetUserId)
    );
    
    if (membership) {
      return c.json({
        success: true,
        data: membership
      });
    }
  }
  
  throw new NotFoundError('User', targetUserId);
});

/**
 * PATCH /:id/role
 * Update user's role in organization
 */
userRoutes.patch('/:id/role', requireOrgAdmin, async (c) => {
  const targetUserId = c.req.param('id');
  const userOrgId = c.get('organizationId');
  const currentUserId = c.get('userId');
  
  console.log('[Users] Updating role for:', targetUserId);
  
  if (!userOrgId) {
    throw new ForbiddenError('You must belong to an organization');
  }
  
  // Can't change own role
  if (targetUserId === currentUserId) {
    throw new ForbiddenError('You cannot change your own role');
  }
  
  const body = await c.req.json();
  const result = updateUserRoleRequestSchema.safeParse(body);
  
  if (!result.success) {
    throw new ValidationError('Invalid role data', { errors: result.error.errors });
  }
  
  const { role } = result.data;
  
  // Get current membership
  const membershipPath = getUserMembershipPath(userOrgId, targetUserId);
  const membership = await readJSON<OrganizationMembership>(c.env.R2_BUCKET, membershipPath);
  
  if (!membership) {
    throw new NotFoundError('User', targetUserId);
  }
  
  // Update role
  const updatedMembership: OrganizationMembership = {
    ...membership,
    role
  };
  
  await writeJSON(c.env.R2_BUCKET, membershipPath, updatedMembership);
  
  console.log('[Users] Updated role for:', targetUserId, 'to:', role);
  
  return c.json({
    success: true,
    data: updatedMembership
  });
});

/**
 * DELETE /:id
 * Remove user from organization
 */
userRoutes.delete('/:id', requireOrgAdmin, async (c) => {
  const targetUserId = c.req.param('id');
  const userOrgId = c.get('organizationId');
  const currentUserId = c.get('userId');
  
  console.log('[Users] Removing user:', targetUserId);
  
  if (!userOrgId) {
    throw new ForbiddenError('You must belong to an organization');
  }
  
  // Can't remove self
  if (targetUserId === currentUserId) {
    throw new ForbiddenError('You cannot remove yourself from the organization');
  }
  
  // Get membership
  const membershipPath = getUserMembershipPath(userOrgId, targetUserId);
  const membership = await readJSON<OrganizationMembership>(c.env.R2_BUCKET, membershipPath);
  
  if (!membership) {
    throw new NotFoundError('User', targetUserId);
  }
  
  // Delete membership
  await deleteFile(c.env.R2_BUCKET, membershipPath);
  
  console.log('[Users] Removed user:', targetUserId, 'from org:', userOrgId);
  
  return c.json({
    success: true,
    data: { message: 'User removed from organization' }
  });
});

// Preferences and flags routes

/**
 * GET /me/preferences
 * Get current user's preferences
 */
userRoutes.get('/me/preferences', async (c) => {
  const userId = c.get('userId')!;
  console.log('[Users] Getting preferences for:', userId);
  
  const preferences = await readJSON<UserPreferences>(
    c.env.R2_BUCKET,
    getUserPreferencesPath(userId)
  );
  
  // Return defaults if not set
  const defaultPreferences: UserPreferences = {
    userId,
    notifications: {
      emailAlerts: true,
      alertFrequency: 'daily'
    },
    ui: {
      theme: 'system',
      language: 'en'
    },
    updatedAt: new Date().toISOString()
  };
  
  return c.json({
    success: true,
    data: preferences || defaultPreferences
  });
});

/**
 * PATCH /me/preferences
 * Update current user's preferences
 */
userRoutes.patch('/me/preferences', async (c) => {
  const userId = c.get('userId')!;
  console.log('[Users] Updating preferences for:', userId);
  
  const body = await c.req.json();
  const result = updateUserPreferencesRequestSchema.safeParse(body);
  
  if (!result.success) {
    throw new ValidationError('Invalid preferences data', { errors: result.error.errors });
  }
  
  const updates = result.data;
  
  // Get current preferences
  const prefsPath = getUserPreferencesPath(userId);
  const currentPrefs = await readJSON<UserPreferences>(c.env.R2_BUCKET, prefsPath);
  
  const updatedPrefs: UserPreferences = {
    userId,
    notifications: {
      emailAlerts: updates.notifications?.emailAlerts ?? currentPrefs?.notifications?.emailAlerts ?? true,
      alertFrequency: updates.notifications?.alertFrequency ?? currentPrefs?.notifications?.alertFrequency ?? 'daily',
      digestTime: updates.notifications?.digestTime ?? currentPrefs?.notifications?.digestTime
    },
    ui: {
      theme: updates.ui?.theme ?? currentPrefs?.ui?.theme ?? 'system',
      language: updates.ui?.language ?? currentPrefs?.ui?.language ?? 'en'
    },
    updatedAt: new Date().toISOString()
  };
  
  await writeJSON(c.env.R2_BUCKET, prefsPath, updatedPrefs);
  
  console.log('[Users] Updated preferences for:', userId);
  
  return c.json({
    success: true,
    data: updatedPrefs
  });
});

/**
 * GET /me/flags
 * Get current user's flagged entities
 */
userRoutes.get('/me/flags', async (c) => {
  const userId = c.get('userId')!;
  console.log('[Users] Getting flags for:', userId);
  
  const flagFiles = await listFiles(c.env.R2_BUCKET, `${R2_PATHS.PRIVATE}users/${userId}/flags/`);
  const jsonFiles = flagFiles.filter(f => f.endsWith('.json'));
  
  const flags: EntityFlag[] = [];
  
  for (const file of jsonFiles) {
    const flag = await readJSON<EntityFlag>(c.env.R2_BUCKET, file);
    if (flag) {
      flags.push(flag);
    }
  }
  
  // Sort by flaggedAt
  flags.sort((a, b) => new Date(b.flaggedAt).getTime() - new Date(a.flaggedAt).getTime());
  
  console.log('[Users] Found', flags.length, 'flags');
  
  return c.json({
    success: true,
    data: {
      items: flags,
      total: flags.length
    }
  });
});

/**
 * POST /me/flags
 * Flag an entity for alerts
 */
userRoutes.post('/me/flags', async (c) => {
  const userId = c.get('userId')!;
  console.log('[Users] Creating flag');
  
  const body = await c.req.json();
  const result = flagEntityRequestSchema.safeParse(body);
  
  if (!result.success) {
    throw new ValidationError('Invalid flag data', { errors: result.error.errors });
  }
  
  const { entityId, note } = result.data;
  
  // Verify entity exists
  const stub = await readJSON<EntityStub>(c.env.R2_BUCKET, getEntityStubPath(entityId));
  
  if (!stub) {
    throw new NotFoundError('Entity', entityId);
  }
  
  // Check if already flagged
  const flagPath = getUserFlagsPath(userId, entityId);
  const existingFlag = await readJSON<EntityFlag>(c.env.R2_BUCKET, flagPath);
  
  if (existingFlag) {
    throw new ConflictError('This entity is already flagged');
  }
  
  // Create flag
  const flag: EntityFlag = {
    userId,
    entityId,
    entityTypeId: stub.entityTypeId,
    flaggedAt: new Date().toISOString(),
    note
  };
  
  await writeJSON(c.env.R2_BUCKET, flagPath, flag);
  
  console.log('[Users] Created flag for entity:', entityId);
  
  return c.json({
    success: true,
    data: flag
  }, 201);
});

/**
 * DELETE /me/flags/:entityId
 * Remove a flag from an entity
 */
userRoutes.delete('/me/flags/:entityId', async (c) => {
  const userId = c.get('userId')!;
  const entityId = c.req.param('entityId');
  
  console.log('[Users] Removing flag for entity:', entityId);
  
  const flagPath = getUserFlagsPath(userId, entityId);
  const flag = await readJSON<EntityFlag>(c.env.R2_BUCKET, flagPath);
  
  if (!flag) {
    throw new NotFoundError('Flag', entityId);
  }
  
  await deleteFile(c.env.R2_BUCKET, flagPath);
  
  console.log('[Users] Removed flag for entity:', entityId);
  
  return c.json({
    success: true,
    data: { message: 'Flag removed successfully' }
  });
});
