/**
 * CASL Ability Definitions
 * 
 * Defines role-based permissions using CASL for fine-grained authorization.
 * Abilities are built per-request based on user role, organization memberships,
 * and membership keys (access tiers).
 */

import { AbilityBuilder, PureAbility } from '@casl/ability';
import type { MembershipKeyId } from '@1cc/shared';
import type { Context, Next } from 'hono';
import { getUserMembershipKeys, loadAppConfig } from './bundle-invalidation';
import { ForbiddenError } from '../middleware/error';

export type Actions = 'create' | 'read' | 'update' | 'delete' | 'manage' | 'approve';
export type Subjects = 'Entity' | 'EntityType' | 'Organization' | 'User' | 'Platform' | 'all';

export type AppAbility = PureAbility<[Actions, Subjects]>;

/**
 * Define abilities for a user based on their role, organization memberships, and membership keys
 */
export function defineAbilityFor(user: {
  isSuperadmin: boolean;
  orgMemberships: Array<{ orgId: string; role: 'org_admin' | 'org_member' }>;
  currentOrgId?: string;
  membershipKeys?: MembershipKeyId[]; // User's membership keys (from org tier)
}): AppAbility {
  const { can, cannot, build } = new AbilityBuilder<AppAbility>(PureAbility);

  if (user.isSuperadmin) {
    // Superadmins can do everything
    can('manage', 'all');
  } else {
    // Find role in current org
    const membership = user.orgMemberships.find(m => m.orgId === user.currentOrgId);
    
    if (membership?.role === 'org_admin') {
      // Org admins can manage entities in their org
      can('manage', 'Entity');
      can('read', 'User');
      can('create', 'User'); // Invite users
      can('update', 'User'); // Change roles
    } else if (membership?.role === 'org_member') {
      // Org members can only read
      can('read', 'Entity');
      can('read', 'User');
    }
    
    // Membership keys control what content is visible, but don't grant additional actions
    // They're checked separately when serving bundles/manifests
  }

  return build();
}

/**
 * Middleware to require a specific membership key
 * 
 * Returns 403 Forbidden if the user doesn't have the required key.
 * Superadmins always pass this check (they have all keys).
 * 
 * @param requiredKey - The membership key ID required for access
 * @returns Hono middleware function
 * 
 * @example
 * // Require 'member' key for a route
 * app.get('/member-content', requireMembershipKey('member'), async (c) => { ... });
 */
export function requireMembershipKey(requiredKey: MembershipKeyId) {
  return async (c: Context, next: Next) => {
    const userId = c.get('userId');
    const userRole = c.get('userRole');
    const userOrgId = c.get('organizationId');
    
    // Not authenticated - reject
    if (!userId) {
      throw new ForbiddenError(`Requires '${requiredKey}' membership key - authentication required`);
    }
    
    // Superadmins have all keys
    const isSuperadmin = userRole === 'superadmin';
    if (isSuperadmin) {
      console.log('[Abilities] Superadmin bypasses membership key check');
      await next();
      return;
    }
    
    // Get user's membership keys based on their org's tier
    const config = await loadAppConfig(c.env.R2_BUCKET);
    const userKeys = await getUserMembershipKeys(
      c.env.R2_BUCKET,
      userOrgId || null,
      false, // not superadmin (already checked above)
      config
    );
    
    console.log('[Abilities] User membership keys:', userKeys, 'required:', requiredKey);
    
    // Check if user has the required key
    if (!userKeys.includes(requiredKey)) {
      const keyDef = config.membershipKeys.keys.find(k => k.id === requiredKey);
      const keyName = keyDef?.name || requiredKey;
      throw new ForbiddenError(`Requires '${keyName}' membership to access this content`);
    }
    
    await next();
  };
}
