/**
 * Organization Routes
 * 
 * Handles organization management:
 * - POST / - Create organization (superadmin)
 * - GET / - List organizations
 * - GET /:id - Get organization details
 * - PATCH /:id - Update organization
 * - DELETE /:id - Soft delete organization
 * - GET /:id/permissions - Get entity type permissions
 * - PATCH /:id/permissions - Update entity type permissions
 * - POST /:id/users/invite - Invite user to organization (superadmin)
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../types';
import { 
  createOrganizationRequestSchema, 
  updateOrganizationRequestSchema,
  updateEntityTypePermissionsRequestSchema,
  inviteUserRequestSchema,
  addUserToOrgRequestSchema
} from '@1cc/shared';
import { readJSON, writeJSON, listFiles, deleteFile, getOrgProfilePath, getOrgPermissionsPath, getInvitationPath, getUserMembershipPath } from '../lib/r2';
import { regenerateOrgManifest, regenerateOrgBundles, loadAppConfig, validateMembershipKeyIds, regenerateEntityBundles } from '../lib/bundle-invalidation';
import { createOrgId, createSlug, createInvitationToken } from '../lib/id';
import { requireSuperadmin, requireOrgAdmin, requireOrgMembership } from '../middleware/auth';
import { NotFoundError, ConflictError, ValidationError } from '../middleware/error';
import { sendInvitationEmail } from '../lib/email';
import { createUserOrgStub, deleteUserOrgStub, updateUserOrgStubRole } from '../lib/user-stubs';
import { R2_PATHS } from '@1cc/shared';
import type { Organization, EntityTypePermissions, OrganizationListItem, UserInvitation, OrganizationMembership, UserRole, EntityType } from '@1cc/shared';

export const organizationRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * POST /
 * Create a new organization (superadmin only)
 */
organizationRoutes.post('/',
  requireSuperadmin(),
  zValidator('json', createOrganizationRequestSchema),
  async (c) => {
  console.log('[Orgs] Creating organization');
  
  const { name, slug, description, domainWhitelist, allowSelfSignup, membershipKey } = c.req.valid('json');
  console.log('[Orgs] Creating organization with name:', name, 'slug:', slug, 'key:', membershipKey);
  
  // Load config and validate membership key if provided
  const config = await loadAppConfig(c.env.R2_BUCKET);
  
  // Use provided key or default to 'platform'
  const finalKey = membershipKey || 'platform';
  
  // Validate membershipKey references a valid key ID
  const invalidKeys = validateMembershipKeyIds([finalKey], config);
  if (invalidKeys.length > 0) {
    const validKeys = config.membershipKeys.keys.map(k => k.id).join(', ');
    throw new ValidationError(`Invalid membership key '${finalKey}'. Valid keys are: ${validKeys}`);
  }
  
  // Check if slug is unique
  console.log('[Orgs] Checking slug uniqueness for:', slug);
  const existingOrg = await findOrgBySlug(c.env.R2_BUCKET, slug);
  if (existingOrg) {
    console.log('[Orgs] Conflict detected - organization with slug already exists:');
    console.log('[Orgs]   Existing org ID:', existingOrg.id);
    console.log('[Orgs]   Existing org name:', existingOrg.name);
    console.log('[Orgs]   Existing org slug:', existingOrg.slug);
    console.log('[Orgs]   Existing org path:', getOrgProfilePath(existingOrg.id));
    throw new ConflictError(`Organization with slug '${slug}' already exists`);
  }
  console.log('[Orgs] Slug is unique, proceeding with creation');
  
  const orgId = createOrgId();
  const now = new Date().toISOString();
  
  const organization: Organization = {
    id: orgId,
    name,
    slug,
    profile: {
      description: description || undefined
    },
    settings: {
      domainWhitelist: domainWhitelist || [],
      allowSelfSignup: allowSelfSignup ?? false
    },
    membershipKey: finalKey,
    createdAt: now,
    updatedAt: now,
    isActive: true
  };
  
  // Save organization profile
  const profilePath = getOrgProfilePath(orgId);
  console.log('[Orgs] Saving organization profile to:', profilePath);
  await writeJSON(c.env.R2_BUCKET, profilePath, organization);
  
  // Verify the file was written by reading it back
  const verifyOrg = await readJSON<Organization>(c.env.R2_BUCKET, profilePath);
  if (verifyOrg) {
    console.log('[Orgs] Verified organization file exists:', verifyOrg.id, verifyOrg.name);
  } else {
    console.error('[Orgs] WARNING: Organization file was not found after write!');
  }
  
  // Initialize empty entity type permissions
  const permissions: EntityTypePermissions = {
    organizationId: orgId,
    viewable: [],
    creatable: [],
    updatedAt: now,
    updatedBy: c.get('userId')!
  };
  
  const permissionsPath = getOrgPermissionsPath(orgId);
  console.log('[Orgs] Saving permissions to:', permissionsPath);
  await writeJSON(c.env.R2_BUCKET, permissionsPath, permissions);
  
  console.log('[Orgs] Created organization:', orgId, 'at path:', profilePath);
  
  // Generate bundles for all entity types for this new organization (even if empty)
  // This ensures bundles exist immediately when the organization is created
  console.log('[Orgs] Generating bundles for all entity types for new organization:', orgId);
  try {
    const typeFiles = await listFiles(c.env.R2_BUCKET, `${R2_PATHS.PUBLIC}entity-types/`);
    const definitionFiles = typeFiles.filter(f => f.endsWith('/definition.json'));
    
    for (const file of definitionFiles) {
      const entityType = await readJSON<EntityType>(c.env.R2_BUCKET, file);
      if (entityType && entityType.isActive) {
        try {
          await regenerateEntityBundles(c.env.R2_BUCKET, entityType.id, orgId, config);
        } catch (error) {
          console.error('[Orgs] Error generating bundles for type', entityType.id, ':', error);
          // Continue with other types even if one fails
        }
      }
    }
    console.log('[Orgs] Bundle generation complete for new organization:', orgId);
  } catch (error) {
    console.error('[Orgs] Error generating bundles for new organization:', orgId, error);
    // Don't fail organization creation if bundle generation fails - log and continue
  }
  
  return c.json({
    success: true,
    data: organization
  }, 201);
});

/**
 * GET /
 * List all organizations
 * Query param: adminOnly - if true, only return orgs where user is an admin
 */
organizationRoutes.get('/', async (c) => {
  console.log('[Orgs] Listing organizations');
  
  const userRole = c.get('userRole');
  const userId = c.get('userId');
  const userOrgId = c.get('organizationId');
  const query = c.req.query();
  const adminOnly = query.adminOnly === 'true';
  
  console.log('[Orgs] Listing params:', {
    userRole,
    userId,
    userOrgId,
    adminOnly,
    isSuperadmin: userRole === 'superadmin'
  });
  
  // If requesting admin-only orgs, return organizations where user is an admin
  if (adminOnly && userId) {
    const adminOrgs = await findAdminOrganizations(c.env.R2_BUCKET, userId, userRole === 'superadmin');
    return c.json({
      success: true,
      data: {
        items: adminOrgs,
        total: adminOrgs.length
      }
    });
  }
  
  // Non-superadmins can only see their own organization
  if (userRole !== 'superadmin') {
    console.log('[Orgs] User is not superadmin, returning own org only');
    if (!userOrgId) {
      console.log('[Orgs] No userOrgId, returning empty list');
      return c.json({
        success: true,
        data: { items: [], total: 0 }
      });
    }
    
    const org = await readJSON<Organization>(c.env.R2_BUCKET, getOrgProfilePath(userOrgId));
    
    if (!org || !org.isActive) {
      return c.json({
        success: true,
        data: { items: [], total: 0 }
      });
    }
    
    const item: OrganizationListItem = {
      id: org.id,
      name: org.name,
      slug: org.slug,
      membershipKey: org.membershipKey || 'public',
      memberCount: await countOrgMembers(c.env.R2_BUCKET, org.id),
      entityCount: await countOrgEntities(c.env.R2_BUCKET, org.id),
      createdAt: org.createdAt,
      isActive: org.isActive
    };
    
    return c.json({
      success: true,
      data: { items: [item], total: 1 }
    });
  }
  
  // Superadmin: list all organizations
  console.log('[Orgs] User is superadmin, listing all organizations');
  const prefix = `${R2_PATHS.PRIVATE}orgs/`;
  console.log('[Orgs] Listing files with prefix:', prefix);
  const orgFiles = await listFiles(c.env.R2_BUCKET, prefix);
  console.log('[Orgs] Raw files from R2:', orgFiles.length, 'files');
  if (orgFiles.length > 0) {
    console.log('[Orgs] All files returned:', orgFiles);
    console.log('[Orgs] Sample files (first 10):', orgFiles.slice(0, 10));
  } else {
    console.warn('[Orgs] No files found with prefix:', prefix);
  }
  
  // Filter for profile.json files - must be in format: private/orgs/{orgId}/profile.json
  const profileFiles = orgFiles.filter(f => {
    // Check both with and without leading slash
    const endsWithProfile = f.endsWith('/profile.json') || f.endsWith('profile.json');
    const hasOrgs = f.includes('/orgs/') || f.includes('orgs/');
    const isProfileFile = endsWithProfile && hasOrgs;
    
    if (!isProfileFile && (f.includes('orgs/') || f.includes('/orgs/'))) {
      console.log('[Orgs] Skipping non-profile file:', f, '(endsWith /profile.json:', f.endsWith('/profile.json'), ', endsWith profile.json:', f.endsWith('profile.json'), ')');
    }
    return isProfileFile;
  });
  console.log('[Orgs] Profile files after filter:', profileFiles.length, 'files');
  if (profileFiles.length > 0) {
    console.log('[Orgs] Profile file paths:', profileFiles);
  } else if (orgFiles.length > 0) {
    console.error('[Orgs] ERROR: Found', orgFiles.length, 'files but none matched profile.json filter!');
  }
  
  const items: OrganizationListItem[] = [];
  
  for (const file of profileFiles) {
    const org = await readJSON<Organization>(c.env.R2_BUCKET, file);
    if (!org) {
      console.log('[Orgs] Failed to read org from file:', file);
      continue;
    }
    console.log('[Orgs] Loaded org:', org.id, org.name);
    
    items.push({
      id: org.id,
      name: org.name,
      slug: org.slug,
      membershipKey: org.membershipKey || 'public',
      memberCount: await countOrgMembers(c.env.R2_BUCKET, org.id),
      entityCount: await countOrgEntities(c.env.R2_BUCKET, org.id),
      createdAt: org.createdAt,
      isActive: org.isActive
    });
  }
  
  // Sort by name
  items.sort((a, b) => a.name.localeCompare(b.name));
  
  console.log('[Orgs] Found', items.length, 'organizations');
  
  return c.json({
    success: true,
    data: {
      items,
      total: items.length
    }
  });
});

/**
 * GET /:id
 * Get organization details
 */
organizationRoutes.get('/:id', requireOrgMembership('id'), async (c) => {
  const orgId = c.req.param('id');
  console.log('[Orgs] Getting organization:', orgId);
  
  const org = await readJSON<Organization>(c.env.R2_BUCKET, getOrgProfilePath(orgId));
  
  if (!org) {
    throw new NotFoundError('Organization', orgId);
  }
  
  return c.json({
    success: true,
    data: org
  });
});

/**
 * PATCH /:id
 * Update organization
 */
organizationRoutes.patch('/:id',
  requireOrgAdmin('id'),
  zValidator('json', updateOrganizationRequestSchema),
  async (c) => {
  const orgId = c.req.param('id');
  console.log('[Orgs] Updating organization:', orgId);
  
  const org = await readJSON<Organization>(c.env.R2_BUCKET, getOrgProfilePath(orgId));
  
  if (!org) {
    throw new NotFoundError('Organization', orgId);
  }
  
  const updates = c.req.valid('json');
  
  // Validate membershipKey if provided
  if (updates.membershipKey) {
    const config = await loadAppConfig(c.env.R2_BUCKET);
    const invalidKeys = validateMembershipKeyIds([updates.membershipKey], config);
    if (invalidKeys.length > 0) {
      const validKeys = config.membershipKeys.keys.map(k => k.id).join(', ');
      throw new ValidationError(`Invalid membership key '${updates.membershipKey}'. Valid keys are: ${validKeys}`);
    }
  }
  
  // Check slug uniqueness if changing
  if (updates.slug && updates.slug !== org.slug) {
    const existingOrg = await findOrgBySlug(c.env.R2_BUCKET, updates.slug);
    if (existingOrg) {
      throw new ConflictError(`Organization with slug '${updates.slug}' already exists`);
    }
  }
  
  // Merge updates
  const updatedOrg: Organization = {
    ...org,
    name: updates.name ?? org.name,
    slug: updates.slug ?? org.slug,
    profile: {
      ...org.profile,
      ...updates.profile
    },
    settings: {
      ...org.settings,
      ...updates.settings
    },
    membershipKey: updates.membershipKey ?? org.membershipKey,
    updatedAt: new Date().toISOString()
  };
  
  await writeJSON(c.env.R2_BUCKET, getOrgProfilePath(orgId), updatedOrg);
  
  console.log('[Orgs] Updated organization:', orgId);
  
  return c.json({
    success: true,
    data: updatedOrg
  });
});

/**
 * DELETE /:id
 * Soft delete organization (superadmin only)
 */
organizationRoutes.delete('/:id', requireSuperadmin(), async (c) => {
  const orgId = c.req.param('id');
  console.log('[Orgs] Deleting organization:', orgId);
  
  const org = await readJSON<Organization>(c.env.R2_BUCKET, getOrgProfilePath(orgId));
  
  if (!org) {
    throw new NotFoundError('Organization', orgId);
  }
  
  // Soft delete - mark as inactive
  const updatedOrg: Organization = {
    ...org,
    isActive: false,
    updatedAt: new Date().toISOString()
  };
  
  await writeJSON(c.env.R2_BUCKET, getOrgProfilePath(orgId), updatedOrg);
  
  console.log('[Orgs] Soft deleted organization:', orgId);
  
  return c.json({
    success: true,
    data: { message: 'Organization deleted successfully' }
  });
});

/**
 * GET /:id/permissions
 * Get entity type permissions for organization
 */
organizationRoutes.get('/:id/permissions', requireOrgMembership('id'), async (c) => {
  const orgId = c.req.param('id');
  console.log('[Orgs] Getting permissions for:', orgId);
  
  const permissions = await readJSON<EntityTypePermissions>(
    c.env.R2_BUCKET, 
    getOrgPermissionsPath(orgId)
  );
  
  if (!permissions) {
    // Return empty permissions if not set
    return c.json({
      success: true,
      data: {
        organizationId: orgId,
        viewable: [],
        creatable: [],
        updatedAt: null,
        updatedBy: null
      }
    });
  }
  
  return c.json({
    success: true,
    data: permissions
  });
});

/**
 * PATCH /:id/permissions
 * Update entity type permissions (superadmin only)
 */
organizationRoutes.patch('/:id/permissions',
  requireSuperadmin(),
  zValidator('json', updateEntityTypePermissionsRequestSchema),
  async (c) => {
  const orgId = c.req.param('id');
  console.log('[Orgs] Updating permissions for:', orgId);
  
  // Verify org exists
  const org = await readJSON<Organization>(c.env.R2_BUCKET, getOrgProfilePath(orgId));
  if (!org) {
    throw new NotFoundError('Organization', orgId);
  }
  
  const currentPermissions = await readJSON<EntityTypePermissions>(
    c.env.R2_BUCKET, 
    getOrgPermissionsPath(orgId)
  );
  
  const updates = c.req.valid('json');
  const now = new Date().toISOString();
  
  const updatedPermissions: EntityTypePermissions = {
    organizationId: orgId,
    viewable: updates.viewable ?? currentPermissions?.viewable ?? [],
    creatable: updates.creatable ?? currentPermissions?.creatable ?? [],
    updatedAt: now,
    updatedBy: c.get('userId')!
  };
  
  // Ensure creatable is subset of viewable
  updatedPermissions.creatable = updatedPermissions.creatable.filter(
    id => updatedPermissions.viewable.includes(id)
  );
  
  await writeJSON(c.env.R2_BUCKET, getOrgPermissionsPath(orgId), updatedPermissions);
  
  console.log('[Orgs] Updated permissions for:', orgId);
  
  // Regenerate org bundles and manifest for the new permissions
  // This ensures the org has bundles for all viewable types
  const config = await loadAppConfig(c.env.R2_BUCKET);
  await regenerateOrgBundles(c.env.R2_BUCKET, orgId, updatedPermissions.viewable, config);
  
  return c.json({
    success: true,
    data: updatedPermissions
  });
});

/**
 * POST /:id/users/invite
 * Invite a user to a specific organization (superadmin only)
 * This allows superadmins to invite admins to newly created organizations.
 * 
 * If the user already exists in the system, they are added directly to the
 * organization and a notification email is sent (no acceptance required).
 * If the user doesn't exist, an invitation email with magic link is sent.
 */
organizationRoutes.post('/:id/users/invite',
  requireSuperadmin(),
  zValidator('json', inviteUserRequestSchema),
  async (c) => {
  const orgId = c.req.param('id');
  console.log('[Orgs] Superadmin inviting user to org:', orgId);
  
  const { email, role } = c.req.valid('json');
  const currentUserId = c.get('userId')!;
  
  // Verify organization exists
  const org = await readJSON<Organization>(c.env.R2_BUCKET, getOrgProfilePath(orgId));
  if (!org) {
    throw new NotFoundError('Organization', orgId);
  }
  
  // Check if user already exists in this org
  const existingOrgUsers = await listFiles(c.env.R2_BUCKET, `${R2_PATHS.PRIVATE}orgs/${orgId}/users/`);
  
  for (const file of existingOrgUsers) {
    const membership = await readJSON<OrganizationMembership>(c.env.R2_BUCKET, file);
    if (membership && membership.email.toLowerCase() === email.toLowerCase()) {
      throw new ConflictError('This user is already a member of the organization');
    }
  }
  
  // Check if user already exists in the system
  const existingUser = await findUserAcrossSystem(c.env.R2_BUCKET, email, c.env.SUPERADMIN_EMAILS);
  
  if (existingUser) {
    // User exists - add them directly to the organization
    console.log('[Orgs] User exists in system, adding directly:', email);
    
    const now = new Date().toISOString();
    
    // Create membership record
    const membership: OrganizationMembership = {
      userId: existingUser.id,
      organizationId: orgId,
      role,
      email: email.toLowerCase(),
      joinedAt: now,
      invitedBy: currentUserId
    };
    
    // Save membership to org
    await writeJSON(c.env.R2_BUCKET, getUserMembershipPath(orgId, existingUser.id), membership);
    
    // Create user-org stub for fast membership lookup
    await createUserOrgStub(c.env.R2_BUCKET, email, existingUser.id, orgId, role as UserRole);
    
    // Send notification email (not an invitation - they're already added)
    if (c.env.RESEND_API_KEY) {
      // TODO: Send a "you've been added" notification email instead of invitation
      // For now, we'll just log it
      console.log('[Orgs] User added to org, notification would be sent to:', email);
    }
    
    console.log('[Orgs] Existing user added to org:', email, 'as', role);
    
    return c.json({
      success: true,
      data: {
        message: 'User added to organization successfully',
        email,
        organizationId: orgId,
        membership,
        existingUser: true
      }
    }, 201);
  }
  
  // User doesn't exist - send invitation email with magic link
  console.log('[Orgs] User not found in system, sending invitation:', email);
  
  // Create invitation token
  const token = createInvitationToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
  
  const invitation: UserInvitation = {
    token,
    email,
    organizationId: orgId,
    role,
    invitedBy: currentUserId,
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
      'The platform administrator'
    );
    console.log('[Orgs] Invitation email sent to:', email);
  } else {
    console.log('[Orgs] DEV MODE - Invitation link:', inviteLink);
  }
  
  console.log('[Orgs] Invitation created for new user:', email, 'to join org:', orgId);
  
  return c.json({
    success: true,
    data: {
      message: 'Invitation sent successfully',
      email,
      organizationId: orgId,
      expiresAt: expiresAt.toISOString(),
      existingUser: false,
      // Include dev link in non-production environments for testing
      ...(c.env.ENVIRONMENT !== 'production' && { devLink: inviteLink })
    }
  }, 201);
});

/**
 * POST /:id/users/add
 * Add an existing user directly to an organization (superadmin only)
 * This is different from invite - it adds the user immediately without sending an email
 * Used to add existing users (including superadmins) to organizations
 */
organizationRoutes.post('/:id/users/add',
  requireSuperadmin(),
  zValidator('json', addUserToOrgRequestSchema),
  async (c) => {
  const orgId = c.req.param('id');
  console.log('[Orgs] Superadmin adding existing user to org:', orgId);
  
  const { email, role } = c.req.valid('json');
  const currentUserId = c.get('userId')!;
  
  // Verify organization exists
  const org = await readJSON<Organization>(c.env.R2_BUCKET, getOrgProfilePath(orgId));
  if (!org) {
    throw new NotFoundError('Organization', orgId);
  }
  
  // Check if user already exists in this org
  const existingOrgUsers = await listFiles(c.env.R2_BUCKET, `${R2_PATHS.PRIVATE}orgs/${orgId}/users/`);
  
  for (const file of existingOrgUsers) {
    const membership = await readJSON<OrganizationMembership>(c.env.R2_BUCKET, file);
    if (membership && membership.email.toLowerCase() === email.toLowerCase()) {
      throw new ConflictError('This user is already a member of this organization');
    }
  }
  
  // Find the user in the system (they must exist somewhere)
  const existingUser = await findUserAcrossSystem(c.env.R2_BUCKET, email, c.env.SUPERADMIN_EMAILS);
  
  if (!existingUser) {
    throw new ValidationError('User not found. Use the invite feature to add new users who don\'t have an account yet.');
  }
  
  // Use existing user ID or generate a new one for superadmins (who don't have stored records)
  const userId = existingUser.id || createSlug(); // createSlug generates a unique ID
  const now = new Date().toISOString();
  
  // Create membership record
  const membership: OrganizationMembership = {
    userId,
    organizationId: orgId,
    role,
    email: email.toLowerCase(),
    joinedAt: now,
    invitedBy: currentUserId
  };
  
  // Save membership to org
  await writeJSON(c.env.R2_BUCKET, getUserMembershipPath(orgId, userId), membership);
  
  // Create user-org stub for fast membership lookup
  await createUserOrgStub(c.env.R2_BUCKET, email, userId, orgId, role as UserRole);
  
  console.log('[Orgs] User added to org:', email, 'as', role);
  
  return c.json({
    success: true,
    data: {
      message: 'User added to organization successfully',
      membership
    }
  }, 201);
});

/**
 * GET /:id/users
 * List all users in an organization (superadmin only for any org)
 */
organizationRoutes.get('/:id/users', requireSuperadmin(), async (c) => {
  const orgId = c.req.param('id');
  console.log('[Orgs] Listing users for org:', orgId);
  
  // Verify organization exists
  const org = await readJSON<Organization>(c.env.R2_BUCKET, getOrgProfilePath(orgId));
  if (!org) {
    throw new NotFoundError('Organization', orgId);
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
  
  console.log('[Orgs] Found', items.length, 'users');
  
  return c.json({
    success: true,
    data: {
      items,
      total: items.length
    }
  });
});

// Helper functions

/**
 * Find a user across the entire system (all orgs + superadmins)
 */
async function findUserAcrossSystem(
  bucket: R2Bucket, 
  email: string, 
  superadminEmails?: string
): Promise<{ id: string; email: string; role: string; organizationId: string | null } | null> {
  const normalizedEmail = email.toLowerCase();
  
  // Check if user is a superadmin (from environment variable)
  if (superadminEmails) {
    const emails = superadminEmails.split(',').map(e => e.trim().toLowerCase());
    if (emails.includes(normalizedEmail)) {
      // Superadmins exist but don't have stored records - create a virtual ID
      return {
        id: `sa_${normalizedEmail.replace(/[^a-z0-9]/g, '_').substring(0, 20)}`,
        email: normalizedEmail,
        role: 'superadmin',
        organizationId: null
      };
    }
  }
  
  // Search across all organizations
  const orgDirs = await listFiles(bucket, `${R2_PATHS.PRIVATE}orgs/`);
  
  for (const orgDir of orgDirs) {
    const match = orgDir.match(/private\/orgs\/([^\/]+)\//);
    if (!match) continue;
    
    const orgId = match[1];
    const userFiles = await listFiles(bucket, `${R2_PATHS.PRIVATE}orgs/${orgId}/users/`);
    
    for (const userFile of userFiles) {
      if (!userFile.endsWith('.json')) continue;
      
      const membership = await readJSON<OrganizationMembership>(bucket, userFile);
      if (membership && membership.email.toLowerCase() === normalizedEmail) {
        return {
          id: membership.userId,
          email: membership.email,
          role: membership.role,
          organizationId: membership.organizationId
        };
      }
    }
  }
  
  // Check pending users (users who signed up but aren't in an org yet)
  const pendingFiles = await listFiles(bucket, `${R2_PATHS.PRIVATE}pending-users/`);
  
  for (const file of pendingFiles) {
    if (!file.endsWith('.json')) continue;
    
    const pendingUser = await readJSON<{ id: string; email: string }>(bucket, file);
    if (pendingUser && pendingUser.email.toLowerCase() === normalizedEmail) {
      return {
        id: pendingUser.id,
        email: pendingUser.email,
        role: 'org_member',
        organizationId: null
      };
    }
  }
  
  return null;
}

/**
 * Find organization by slug
 */
async function findOrgBySlug(bucket: R2Bucket, slug: string): Promise<Organization | null> {
  console.log('[Orgs] Finding organization by slug:', slug);
  const prefix = `${R2_PATHS.PRIVATE}orgs/`;
  const orgFiles = await listFiles(bucket, prefix);
  
  // Use the same improved filtering logic as the listing endpoint
  const profileFiles = orgFiles.filter(f => {
    // Check both with and without leading slash
    const endsWithProfile = f.endsWith('/profile.json') || f.endsWith('profile.json');
    const hasOrgs = f.includes('/orgs/') || f.includes('orgs/');
    return endsWithProfile && hasOrgs;
  });
  
  console.log('[Orgs] Checking', profileFiles.length, 'profile files for slug:', slug);
  
  for (const file of profileFiles) {
    const org = await readJSON<Organization>(bucket, file);
    if (org) {
      console.log('[Orgs] Checking org:', org.id, 'slug:', org.slug, 'matches?', org.slug === slug);
      if (org.slug === slug) {
        console.log('[Orgs] Found matching organization:', org.id, org.name);
        return org;
      }
    }
  }
  
  console.log('[Orgs] No organization found with slug:', slug);
  return null;
}

/**
 * Count members in an organization
 */
async function countOrgMembers(bucket: R2Bucket, orgId: string): Promise<number> {
  const userFiles = await listFiles(bucket, `${R2_PATHS.PRIVATE}orgs/${orgId}/users/`);
  return userFiles.filter(f => f.endsWith('.json')).length;
}

/**
 * Count entities in an organization
 */
async function countOrgEntities(bucket: R2Bucket, orgId: string): Promise<number> {
  const entityFiles = await listFiles(bucket, `${R2_PATHS.PRIVATE}orgs/${orgId}/entities/`);
  // Count directories (each entity has a directory)
  const entityDirs = new Set(entityFiles.map(f => {
    const match = f.match(/entities\/([^\/]+)\//);
    return match ? match[1] : null;
  }).filter(Boolean));
  return entityDirs.size;
}

/**
 * Find all organizations where a user is an admin
 */
async function findAdminOrganizations(
  bucket: R2Bucket, 
  userId: string, 
  isSuperadmin: boolean
): Promise<OrganizationListItem[]> {
  const items: OrganizationListItem[] = [];
  
  // Superadmins have access to all organizations
  if (isSuperadmin) {
    const prefix = `${R2_PATHS.PRIVATE}orgs/`;
    const orgFiles = await listFiles(bucket, prefix);
    
    // Use the same improved filtering logic as the listing endpoint
    const profileFiles = orgFiles.filter(f => {
      const endsWithProfile = f.endsWith('/profile.json') || f.endsWith('profile.json');
      const hasOrgs = f.includes('/orgs/') || f.includes('orgs/');
      return endsWithProfile && hasOrgs;
    });
    
    for (const file of profileFiles) {
      const org = await readJSON<Organization>(bucket, file);
      if (!org || !org.isActive) continue;
      
      items.push({
        id: org.id,
        name: org.name,
        slug: org.slug,
        membershipKey: org.membershipKey || 'public',
        memberCount: await countOrgMembers(bucket, org.id),
        entityCount: await countOrgEntities(bucket, org.id),
        createdAt: org.createdAt,
        isActive: org.isActive
      });
    }
  } else {
    // Find all organizations where user is an admin
    const orgDirs = await listFiles(bucket, `${R2_PATHS.PRIVATE}orgs/`);
    
    for (const orgDir of orgDirs) {
      const match = orgDir.match(/private\/orgs\/([^\/]+)\//);
      if (!match) continue;
      
      const orgId = match[1];
      
      // Check if user is an admin in this org
      const membership = await readJSON<OrganizationMembership>(
        bucket,
        getUserMembershipPath(orgId, userId)
      );
      
      if (membership && membership.role === 'org_admin') {
        const org = await readJSON<Organization>(bucket, getOrgProfilePath(orgId));
        if (org && org.isActive) {
          items.push({
            id: org.id,
            name: org.name,
            slug: org.slug,
            memberCount: await countOrgMembers(bucket, org.id),
            entityCount: await countOrgEntities(bucket, org.id),
            createdAt: org.createdAt,
            isActive: org.isActive
          });
        }
      }
    }
  }
  
  // Sort by name
  items.sort((a, b) => a.name.localeCompare(b.name));
  
  console.log('[Orgs] Found', items.length, 'organizations where user is admin');
  
  return items;
}
