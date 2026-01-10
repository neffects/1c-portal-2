/**
 * User Setup Flow State Machine
 * 
 * Manages the user authentication and setup process:
 * - emailEntry: User enters email address
 * - validating: Checking email/domain validity
 * - awaitingVerification: Magic link sent, waiting for click
 * - verified: User verified, determining next steps
 * - orgAssignment: Assigning user to organization
 * - complete: Setup complete, user can use app
 */

import { setup, assign } from 'xstate';
import type { User, UserRole } from '@1cc/shared';

// Context type for the user setup machine
export interface UserSetupContext {
  email: string | null;
  token: string | null;
  user: User | null;
  organizationId: string | null;
  role: UserRole | null;
  error: string | null;
  isNewUser: boolean;
}

// Event types for the user setup machine
export type UserSetupEvent =
  | { type: 'SUBMIT_EMAIL'; email: string }
  | { type: 'EMAIL_VALID' }
  | { type: 'EMAIL_INVALID'; error: string }
  | { type: 'MAGIC_LINK_SENT' }
  | { type: 'CLICK_MAGIC_LINK'; token: string }
  | { type: 'LINK_EXPIRED' }
  | { type: 'VERIFICATION_SUCCESS'; user: User; isNewUser: boolean }
  | { type: 'VERIFICATION_FAILED'; error: string }
  | { type: 'ASSIGN_ORG'; organizationId: string; role: UserRole }
  | { type: 'SKIP_ORG' }
  | { type: 'COMPLETE' }
  | { type: 'RESET' };

/**
 * User setup flow state machine
 */
export const userSetupMachine = setup({
  types: {
    context: {} as UserSetupContext,
    events: {} as UserSetupEvent,
  },
  actions: {
    // Log state transitions for debugging
    logTransition: ({ event }) => {
      console.log('[UserSetupMachine] Event:', event.type);
    },
    
    // Set email in context
    setEmail: assign({
      email: (_, params: { email: string }) => params.email
    }),
    
    // Set token in context
    setToken: assign({
      token: (_, params: { token: string }) => params.token
    }),
    
    // Set error in context
    setError: assign({
      error: (_, params: { error: string }) => params.error
    }),
    
    // Clear error
    clearError: assign({
      error: () => null
    }),
    
    // Set verified user
    setUser: assign({
      user: (_, params: { user: User }) => params.user,
      isNewUser: (_, params: { isNewUser: boolean }) => params.isNewUser
    }),
    
    // Set organization assignment
    setOrgAssignment: assign({
      organizationId: (_, params: { organizationId: string }) => params.organizationId,
      role: (_, params: { role: UserRole }) => params.role
    }),
    
    // Reset all context
    resetContext: assign({
      email: () => null,
      token: () => null,
      user: () => null,
      organizationId: () => null,
      role: () => null,
      error: () => null,
      isNewUser: () => false
    })
  },
  guards: {
    // Check if user needs organization assignment
    needsOrgAssignment: ({ context }) => {
      return context.isNewUser && !context.user?.organizationId;
    },
    
    // Check if user already has organization
    hasOrganization: ({ context }) => {
      return !!context.user?.organizationId;
    }
  }
}).createMachine({
  id: 'userSetup',
  initial: 'emailEntry',
  context: {
    email: null,
    token: null,
    user: null,
    organizationId: null,
    role: null,
    error: null,
    isNewUser: false
  },
  states: {
    emailEntry: {
      on: {
        SUBMIT_EMAIL: {
          target: 'validating',
          actions: [
            'logTransition',
            'clearError',
            { type: 'setEmail', params: ({ event }) => ({ email: event.email }) }
          ]
        }
      }
    },
    
    validating: {
      on: {
        EMAIL_VALID: {
          target: 'awaitingVerification',
          actions: ['logTransition']
        },
        EMAIL_INVALID: {
          target: 'emailEntry',
          actions: [
            'logTransition',
            { type: 'setError', params: ({ event }) => ({ error: event.error }) }
          ]
        }
      }
    },
    
    awaitingVerification: {
      on: {
        CLICK_MAGIC_LINK: {
          target: 'verifying',
          actions: [
            'logTransition',
            { type: 'setToken', params: ({ event }) => ({ token: event.token }) }
          ]
        },
        LINK_EXPIRED: {
          target: 'emailEntry',
          actions: [
            'logTransition',
            { type: 'setError', params: () => ({ error: 'Magic link expired. Please request a new one.' }) }
          ]
        }
      }
    },
    
    verifying: {
      on: {
        VERIFICATION_SUCCESS: [
          {
            target: 'orgAssignment',
            guard: 'needsOrgAssignment',
            actions: [
              'logTransition',
              { type: 'setUser', params: ({ event }) => ({ user: event.user, isNewUser: event.isNewUser }) }
            ]
          },
          {
            target: 'complete',
            guard: 'hasOrganization',
            actions: [
              'logTransition',
              { type: 'setUser', params: ({ event }) => ({ user: event.user, isNewUser: event.isNewUser }) }
            ]
          }
        ],
        VERIFICATION_FAILED: {
          target: 'emailEntry',
          actions: [
            'logTransition',
            { type: 'setError', params: ({ event }) => ({ error: event.error }) }
          ]
        }
      }
    },
    
    orgAssignment: {
      on: {
        ASSIGN_ORG: {
          target: 'complete',
          actions: [
            'logTransition',
            { type: 'setOrgAssignment', params: ({ event }) => ({ 
              organizationId: event.organizationId, 
              role: event.role 
            }) }
          ]
        },
        SKIP_ORG: {
          target: 'complete',
          actions: ['logTransition']
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
      target: '.emailEntry',
      actions: ['resetContext']
    }
  }
});

/**
 * Get current step number for progress display
 */
export function getUserSetupStep(state: string): number {
  const steps: Record<string, number> = {
    emailEntry: 1,
    validating: 1,
    awaitingVerification: 2,
    verifying: 2,
    orgAssignment: 3,
    complete: 4
  };
  return steps[state] || 1;
}

/**
 * Get total steps in the flow
 */
export const USER_SETUP_TOTAL_STEPS = 4;
