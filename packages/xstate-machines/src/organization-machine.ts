/**
 * Organization Creation State Machine
 * 
 * Manages the organization creation wizard:
 * - basicInfo: Enter name, slug, description
 * - domainConfig: Configure domain whitelist
 * - permissionConfig: Set entity type permissions
 * - adminAssignment: Assign initial admin user
 * - review: Review all settings before creation
 * - complete: Organization created successfully
 */

import { setup, assign } from 'xstate';
import type { Organization, OrganizationSettings, OrganizationProfile } from '@1cc/shared';

// Context type for the organization creation machine
export interface OrgCreationContext {
  // Basic info
  name: string | null;
  slug: string | null;
  description: string | null;
  
  // Domain config
  domainWhitelist: string[];
  allowSelfSignup: boolean;
  
  // Permissions
  viewableTypes: string[];
  creatableTypes: string[];
  
  // Admin assignment
  adminEmail: string | null;
  adminUserId: string | null;
  
  // Result
  organization: Organization | null;
  error: string | null;
}

// Event types for the organization creation machine
export type OrgCreationEvent =
  | { type: 'SAVE_BASIC_INFO'; name: string; slug: string; description?: string }
  | { type: 'SAVE_DOMAINS'; domains: string[]; allowSelfSignup: boolean }
  | { type: 'SKIP_DOMAINS' }
  | { type: 'SAVE_PERMISSIONS'; viewable: string[]; creatable: string[] }
  | { type: 'ASSIGN_ADMIN'; email: string }
  | { type: 'CONFIRM' }
  | { type: 'EDIT' }
  | { type: 'CREATION_SUCCESS'; organization: Organization }
  | { type: 'CREATION_FAILED'; error: string }
  | { type: 'BACK' }
  | { type: 'RESET' };

/**
 * Organization creation state machine
 */
export const orgCreationMachine = setup({
  types: {
    context: {} as OrgCreationContext,
    events: {} as OrgCreationEvent,
  },
  actions: {
    // Log state transitions for debugging
    logTransition: ({ event }) => {
      console.log('[OrgCreationMachine] Event:', event.type);
    },
    
    // Set basic info
    setBasicInfo: assign({
      name: (_, params: { name: string }) => params.name,
      slug: (_, params: { slug: string }) => params.slug,
      description: (_, params: { description?: string }) => params.description || null
    }),
    
    // Set domain config
    setDomainConfig: assign({
      domainWhitelist: (_, params: { domains: string[] }) => params.domains,
      allowSelfSignup: (_, params: { allowSelfSignup: boolean }) => params.allowSelfSignup
    }),
    
    // Set permissions
    setPermissions: assign({
      viewableTypes: (_, params: { viewable: string[] }) => params.viewable,
      creatableTypes: (_, params: { creatable: string[] }) => params.creatable
    }),
    
    // Set admin email
    setAdminEmail: assign({
      adminEmail: (_, params: { email: string }) => params.email
    }),
    
    // Set created organization
    setOrganization: assign({
      organization: (_, params: { organization: Organization }) => params.organization
    }),
    
    // Set error
    setError: assign({
      error: (_, params: { error: string }) => params.error
    }),
    
    // Clear error
    clearError: assign({
      error: () => null
    }),
    
    // Reset all context
    resetContext: assign({
      name: () => null,
      slug: () => null,
      description: () => null,
      domainWhitelist: () => [],
      allowSelfSignup: () => false,
      viewableTypes: () => [],
      creatableTypes: () => [],
      adminEmail: () => null,
      adminUserId: () => null,
      organization: () => null,
      error: () => null
    })
  },
  guards: {
    // Check if basic info is complete
    hasBasicInfo: ({ context }) => {
      return !!context.name && !!context.slug;
    },
    
    // Check if admin is assigned
    hasAdmin: ({ context }) => {
      return !!context.adminEmail;
    }
  }
}).createMachine({
  id: 'orgCreation',
  initial: 'basicInfo',
  context: {
    name: null,
    slug: null,
    description: null,
    domainWhitelist: [],
    allowSelfSignup: false,
    viewableTypes: [],
    creatableTypes: [],
    adminEmail: null,
    adminUserId: null,
    organization: null,
    error: null
  },
  states: {
    basicInfo: {
      on: {
        SAVE_BASIC_INFO: {
          target: 'domainConfig',
          actions: [
            'logTransition',
            'clearError',
            { type: 'setBasicInfo', params: ({ event }) => ({ 
              name: event.name, 
              slug: event.slug, 
              description: event.description 
            }) }
          ]
        }
      }
    },
    
    domainConfig: {
      on: {
        SAVE_DOMAINS: {
          target: 'permissionConfig',
          actions: [
            'logTransition',
            { type: 'setDomainConfig', params: ({ event }) => ({ 
              domains: event.domains, 
              allowSelfSignup: event.allowSelfSignup 
            }) }
          ]
        },
        SKIP_DOMAINS: {
          target: 'permissionConfig',
          actions: ['logTransition']
        },
        BACK: {
          target: 'basicInfo',
          actions: ['logTransition']
        }
      }
    },
    
    permissionConfig: {
      on: {
        SAVE_PERMISSIONS: {
          target: 'adminAssignment',
          actions: [
            'logTransition',
            { type: 'setPermissions', params: ({ event }) => ({ 
              viewable: event.viewable, 
              creatable: event.creatable 
            }) }
          ]
        },
        BACK: {
          target: 'domainConfig',
          actions: ['logTransition']
        }
      }
    },
    
    adminAssignment: {
      on: {
        ASSIGN_ADMIN: {
          target: 'review',
          actions: [
            'logTransition',
            { type: 'setAdminEmail', params: ({ event }) => ({ email: event.email }) }
          ]
        },
        BACK: {
          target: 'permissionConfig',
          actions: ['logTransition']
        }
      }
    },
    
    review: {
      on: {
        CONFIRM: {
          target: 'creating',
          guard: 'hasBasicInfo',
          actions: ['logTransition']
        },
        EDIT: {
          target: 'basicInfo',
          actions: ['logTransition']
        },
        BACK: {
          target: 'adminAssignment',
          actions: ['logTransition']
        }
      }
    },
    
    creating: {
      on: {
        CREATION_SUCCESS: {
          target: 'complete',
          actions: [
            'logTransition',
            { type: 'setOrganization', params: ({ event }) => ({ organization: event.organization }) }
          ]
        },
        CREATION_FAILED: {
          target: 'review',
          actions: [
            'logTransition',
            { type: 'setError', params: ({ event }) => ({ error: event.error }) }
          ]
        }
      }
    },
    
    complete: {
      type: 'final',
      entry: ['logTransition']
    }
  },
  on: {
    RESET: {
      target: '.basicInfo',
      actions: ['resetContext']
    }
  }
});

/**
 * Get current step number for progress display
 */
export function getOrgCreationStep(state: string): number {
  const steps: Record<string, number> = {
    basicInfo: 1,
    domainConfig: 2,
    permissionConfig: 3,
    adminAssignment: 4,
    review: 5,
    creating: 5,
    complete: 6
  };
  return steps[state] || 1;
}

/**
 * Get total steps in the flow
 */
export const ORG_CREATION_TOTAL_STEPS = 5;

/**
 * Build organization object from context
 */
export function buildOrganizationFromContext(
  context: OrgCreationContext,
  id: string,
  createdBy: string
): Omit<Organization, 'createdAt' | 'updatedAt'> {
  return {
    id,
    name: context.name!,
    slug: context.slug!,
    profile: {
      description: context.description || undefined
    },
    settings: {
      domainWhitelist: context.domainWhitelist,
      allowSelfSignup: context.allowSelfSignup
    },
    isActive: true
  };
}
