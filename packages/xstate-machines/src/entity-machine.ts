/**
 * Entity Lifecycle State Machine
 * 
 * Manages entity status transitions:
 * - draft: Work in progress, editable by org admins
 * - pending: Submitted for approval, awaiting superadmin review
 * - published: Live content, visible based on visibility setting
 * - archived: No longer active, hidden from listings
 * - deleted: Soft-deleted, recoverable by superadmin
 */

import { setup, assign } from 'xstate';
import type { Entity, EntityStatus } from '@1cc/shared';

// Context type for the entity machine
export interface EntityMachineContext {
  entity: Entity | null;
  previousStatus: EntityStatus | null;
  feedback: string | null;
  error: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

// Event types for the entity machine
export type EntityMachineEvent =
  | { type: 'CREATE'; entityTypeId: string; data: Record<string, unknown>; userId: string }
  | { type: 'SAVE'; data: Record<string, unknown>; userId: string }
  | { type: 'SUBMIT_FOR_APPROVAL'; userId: string }
  | { type: 'APPROVE'; userId: string }
  | { type: 'REJECT'; feedback: string; userId: string }
  | { type: 'ARCHIVE'; userId: string }
  | { type: 'RESTORE'; userId: string }
  | { type: 'DELETE'; userId: string }
  | { type: 'SUCCESS'; entity: Entity }
  | { type: 'ERROR'; message: string };

/**
 * Entity lifecycle state machine
 */
export const entityMachine = setup({
  types: {
    context: {} as EntityMachineContext,
    events: {} as EntityMachineEvent,
  },
  actions: {
    // Log state transitions for debugging
    logTransition: ({ context, event }) => {
      console.log('[EntityMachine] Transition:', {
        currentStatus: context.entity?.status,
        event: event.type,
        entityId: context.entity?.id
      });
    },
    
    // Set error in context
    setError: assign({
      error: (_, params: { message: string }) => params.message
    }),
    
    // Clear error
    clearError: assign({
      error: () => null
    }),
    
    // Store feedback from rejection
    setFeedback: assign({
      feedback: (_, params: { feedback: string }) => params.feedback
    }),
    
    // Update entity in context
    updateEntity: assign({
      entity: (_, params: { entity: Entity }) => params.entity,
      previousStatus: ({ context }) => context.entity?.status ?? null,
      updatedAt: () => new Date().toISOString()
    })
  },
  guards: {
    // Check if entity can be submitted (has required fields)
    canSubmit: ({ context }) => {
      if (!context.entity) return false;
      // Entity must be in draft status
      return context.entity.status === 'draft';
    },
    
    // Check if entity can be approved
    canApprove: ({ context }) => {
      if (!context.entity) return false;
      return context.entity.status === 'pending';
    },
    
    // Check if entity can be archived
    canArchive: ({ context }) => {
      if (!context.entity) return false;
      return context.entity.status === 'published';
    },
    
    // Check if entity can be restored
    canRestore: ({ context }) => {
      if (!context.entity) return false;
      return ['archived', 'deleted'].includes(context.entity.status);
    }
  }
}).createMachine({
  id: 'entityLifecycle',
  initial: 'idle',
  context: {
    entity: null,
    previousStatus: null,
    feedback: null,
    error: null,
    updatedAt: null,
    updatedBy: null
  },
  states: {
    idle: {
      on: {
        CREATE: {
          target: 'draft',
          actions: ['logTransition', 'clearError']
        }
      }
    },
    
    draft: {
      on: {
        SAVE: {
          target: 'saving',
          actions: ['logTransition']
        },
        SUBMIT_FOR_APPROVAL: {
          target: 'pending',
          guard: 'canSubmit',
          actions: ['logTransition']
        },
        DELETE: {
          target: 'deleted',
          actions: ['logTransition']
        }
      }
    },
    
    saving: {
      on: {
        SUCCESS: {
          target: 'draft',
          actions: [
            'logTransition',
            { type: 'updateEntity', params: ({ event }) => ({ entity: event.entity }) }
          ]
        },
        ERROR: {
          target: 'draft',
          actions: [
            { type: 'setError', params: ({ event }) => ({ message: event.message }) }
          ]
        }
      }
    },
    
    pending: {
      on: {
        APPROVE: {
          target: 'published',
          guard: 'canApprove',
          actions: ['logTransition']
        },
        REJECT: {
          target: 'draft',
          guard: 'canApprove',
          actions: [
            'logTransition',
            { type: 'setFeedback', params: ({ event }) => ({ feedback: event.feedback }) }
          ]
        }
      }
    },
    
    published: {
      on: {
        ARCHIVE: {
          target: 'archived',
          guard: 'canArchive',
          actions: ['logTransition']
        }
      }
    },
    
    archived: {
      on: {
        RESTORE: {
          target: 'draft',
          guard: 'canRestore',
          actions: ['logTransition']
        }
      }
    },
    
    deleted: {
      on: {
        RESTORE: {
          target: 'draft',
          guard: 'canRestore',
          actions: ['logTransition']
        }
      }
    }
  }
});

/**
 * Get allowed transitions for a given status
 * 
 * Note: 'superDelete' is a superadmin-only action that bypasses this validation.
 * It can be called from ANY status and permanently removes the entity.
 * The superDelete action is handled specially in the super/entities.ts route.
 */
export function getAllowedTransitions(status: EntityStatus): string[] {
  const transitions: Record<EntityStatus, string[]> = {
    draft: ['save', 'submitForApproval', 'delete'],
    pending: ['approve', 'reject'],
    published: ['archive'],
    archived: ['restore'],
    deleted: ['restore']
  };
  return transitions[status] || [];
}

/**
 * Check if a transition is valid
 */
export function isValidTransition(
  currentStatus: EntityStatus,
  action: string
): boolean {
  return getAllowedTransitions(currentStatus).includes(action);
}
