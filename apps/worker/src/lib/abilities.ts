/**
 * CASL Ability Definitions
 * 
 * Defines role-based permissions using CASL for fine-grained authorization.
 * Abilities are built per-request based on user role and organization context.
 */

import { AbilityBuilder, PureAbility } from '@casl/ability';

export type Actions = 'create' | 'read' | 'update' | 'delete' | 'manage' | 'approve';
export type Subjects = 'Entity' | 'EntityType' | 'Organization' | 'User' | 'Platform' | 'all';

export type AppAbility = PureAbility<[Actions, Subjects]>;

/**
 * Define abilities for a user based on their role and organization memberships
 */
export function defineAbilityFor(user: {
  isSuperadmin: boolean;
  orgMemberships: Array<{ orgId: string; role: 'org_admin' | 'org_member' }>;
  currentOrgId?: string;
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
  }

  return build();
}
