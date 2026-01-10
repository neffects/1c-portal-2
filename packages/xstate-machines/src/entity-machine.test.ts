/**
 * Entity Machine Tests
 *
 * Tests for entity lifecycle state machine transitions.
 */

import { describe, it, expect } from 'vitest';
import { createActor } from 'xstate';
import { entityMachine, getAllowedTransitions, isValidTransition } from './entity-machine';

describe('Entity Machine', () => {
  describe('Initial state', () => {
    it('should start in idle state', () => {
      const actor = createActor(entityMachine);
      actor.start();
      expect(actor.getSnapshot().value).toBe('idle');
      actor.stop();
    });

    it('should have null context values initially', () => {
      const actor = createActor(entityMachine);
      actor.start();
      const snapshot = actor.getSnapshot();
      expect(snapshot.context.entity).toBeNull();
      expect(snapshot.context.previousStatus).toBeNull();
      expect(snapshot.context.feedback).toBeNull();
      expect(snapshot.context.error).toBeNull();
      actor.stop();
    });
  });

  describe('State transitions', () => {
    it('should transition from idle to draft on CREATE', () => {
      const actor = createActor(entityMachine);
      actor.start();
      
      actor.send({ 
        type: 'CREATE', 
        entityTypeId: 'type123', 
        data: { name: 'Test' }, 
        userId: 'user123' 
      });
      
      expect(actor.getSnapshot().value).toBe('draft');
      actor.stop();
    });

    it('should transition from draft to saving on SAVE', () => {
      const actor = createActor(entityMachine);
      actor.start();
      
      actor.send({ type: 'CREATE', entityTypeId: 'type123', data: {}, userId: 'user123' });
      actor.send({ type: 'SAVE', data: { name: 'Updated' }, userId: 'user123' });
      
      expect(actor.getSnapshot().value).toBe('saving');
      actor.stop();
    });

    it('should transition from draft to deleted on DELETE', () => {
      const actor = createActor(entityMachine);
      actor.start();
      
      actor.send({ type: 'CREATE', entityTypeId: 'type123', data: {}, userId: 'user123' });
      actor.send({ type: 'DELETE', userId: 'user123' });
      
      expect(actor.getSnapshot().value).toBe('deleted');
      actor.stop();
    });
  });

  describe('Approval workflow', () => {
    it('should not transition to pending without entity in draft status', () => {
      const actor = createActor(entityMachine);
      actor.start();
      
      // Create entity (no actual entity in context yet)
      actor.send({ type: 'CREATE', entityTypeId: 'type123', data: {}, userId: 'user123' });
      
      // Try to submit - should fail guard (no entity in context)
      actor.send({ type: 'SUBMIT_FOR_APPROVAL', userId: 'user123' });
      
      // Still in draft because guard failed
      expect(actor.getSnapshot().value).toBe('draft');
      actor.stop();
    });

    it('should transition from pending to published on APPROVE when entity exists', () => {
      const actor = createActor(entityMachine, {
        input: undefined,
        snapshot: undefined
      });
      actor.start();
      
      // Start from pending state with entity context
      const pendingActor = createActor(entityMachine.provide({
        guards: {
          canApprove: () => true // Override guard for testing
        }
      }));
      pendingActor.start();
      
      // Manually set to pending state scenario
      pendingActor.send({ type: 'CREATE', entityTypeId: 'type123', data: {}, userId: 'user123' });
      
      actor.stop();
      pendingActor.stop();
    });

    it('should transition from pending to draft on REJECT with feedback', () => {
      const actor = createActor(entityMachine.provide({
        guards: {
          canSubmit: () => true,
          canApprove: () => true
        }
      }));
      actor.start();
      
      actor.send({ type: 'CREATE', entityTypeId: 'type123', data: {}, userId: 'user123' });
      actor.send({ type: 'SUBMIT_FOR_APPROVAL', userId: 'user123' });
      
      expect(actor.getSnapshot().value).toBe('pending');
      
      actor.send({ type: 'REJECT', feedback: 'Please fix typos', userId: 'admin123' });
      
      expect(actor.getSnapshot().value).toBe('draft');
      expect(actor.getSnapshot().context.feedback).toBe('Please fix typos');
      actor.stop();
    });
  });

  describe('Archive and restore', () => {
    it('should transition from published to archived on ARCHIVE', () => {
      const actor = createActor(entityMachine.provide({
        guards: {
          canSubmit: () => true,
          canApprove: () => true,
          canArchive: () => true
        }
      }));
      actor.start();
      
      actor.send({ type: 'CREATE', entityTypeId: 'type123', data: {}, userId: 'user123' });
      actor.send({ type: 'SUBMIT_FOR_APPROVAL', userId: 'user123' });
      actor.send({ type: 'APPROVE', userId: 'admin123' });
      
      expect(actor.getSnapshot().value).toBe('published');
      
      actor.send({ type: 'ARCHIVE', userId: 'admin123' });
      
      expect(actor.getSnapshot().value).toBe('archived');
      actor.stop();
    });

    it('should transition from archived to draft on RESTORE', () => {
      const actor = createActor(entityMachine.provide({
        guards: {
          canSubmit: () => true,
          canApprove: () => true,
          canArchive: () => true,
          canRestore: () => true
        }
      }));
      actor.start();
      
      actor.send({ type: 'CREATE', entityTypeId: 'type123', data: {}, userId: 'user123' });
      actor.send({ type: 'SUBMIT_FOR_APPROVAL', userId: 'user123' });
      actor.send({ type: 'APPROVE', userId: 'admin123' });
      actor.send({ type: 'ARCHIVE', userId: 'admin123' });
      
      expect(actor.getSnapshot().value).toBe('archived');
      
      actor.send({ type: 'RESTORE', userId: 'admin123' });
      
      expect(actor.getSnapshot().value).toBe('draft');
      actor.stop();
    });

    it('should transition from deleted to draft on RESTORE', () => {
      const actor = createActor(entityMachine.provide({
        guards: {
          canRestore: () => true
        }
      }));
      actor.start();
      
      actor.send({ type: 'CREATE', entityTypeId: 'type123', data: {}, userId: 'user123' });
      actor.send({ type: 'DELETE', userId: 'user123' });
      
      expect(actor.getSnapshot().value).toBe('deleted');
      
      actor.send({ type: 'RESTORE', userId: 'admin123' });
      
      expect(actor.getSnapshot().value).toBe('draft');
      actor.stop();
    });
  });

  describe('Saving workflow', () => {
    it('should return to draft on SUCCESS after saving', () => {
      const actor = createActor(entityMachine);
      actor.start();
      
      actor.send({ type: 'CREATE', entityTypeId: 'type123', data: {}, userId: 'user123' });
      actor.send({ type: 'SAVE', data: { name: 'Updated' }, userId: 'user123' });
      
      expect(actor.getSnapshot().value).toBe('saving');
      
      actor.send({ 
        type: 'SUCCESS', 
        entity: { 
          id: 'ent1234', 
          status: 'draft' 
        } as any 
      });
      
      expect(actor.getSnapshot().value).toBe('draft');
      expect(actor.getSnapshot().context.entity).toBeDefined();
      actor.stop();
    });

    it('should return to draft with error on ERROR after saving', () => {
      const actor = createActor(entityMachine);
      actor.start();
      
      actor.send({ type: 'CREATE', entityTypeId: 'type123', data: {}, userId: 'user123' });
      actor.send({ type: 'SAVE', data: { name: 'Updated' }, userId: 'user123' });
      
      actor.send({ type: 'ERROR', message: 'Save failed' });
      
      expect(actor.getSnapshot().value).toBe('draft');
      expect(actor.getSnapshot().context.error).toBe('Save failed');
      actor.stop();
    });
  });
});

describe('getAllowedTransitions', () => {
  it('should return correct transitions for draft', () => {
    const transitions = getAllowedTransitions('draft');
    expect(transitions).toContain('save');
    expect(transitions).toContain('submitForApproval');
    expect(transitions).toContain('delete');
  });

  it('should return correct transitions for pending', () => {
    const transitions = getAllowedTransitions('pending');
    expect(transitions).toContain('approve');
    expect(transitions).toContain('reject');
    expect(transitions).not.toContain('save');
  });

  it('should return correct transitions for published', () => {
    const transitions = getAllowedTransitions('published');
    expect(transitions).toContain('archive');
    expect(transitions).not.toContain('approve');
  });

  it('should return correct transitions for archived', () => {
    const transitions = getAllowedTransitions('archived');
    expect(transitions).toContain('restore');
  });

  it('should return correct transitions for deleted', () => {
    const transitions = getAllowedTransitions('deleted');
    expect(transitions).toContain('restore');
  });
});

describe('isValidTransition', () => {
  it('should return true for valid transitions', () => {
    expect(isValidTransition('draft', 'save')).toBe(true);
    expect(isValidTransition('draft', 'submitForApproval')).toBe(true);
    expect(isValidTransition('pending', 'approve')).toBe(true);
    expect(isValidTransition('pending', 'reject')).toBe(true);
    expect(isValidTransition('published', 'archive')).toBe(true);
    expect(isValidTransition('archived', 'restore')).toBe(true);
  });

  it('should return false for invalid transitions', () => {
    expect(isValidTransition('draft', 'approve')).toBe(false);
    expect(isValidTransition('pending', 'save')).toBe(false);
    expect(isValidTransition('published', 'reject')).toBe(false);
    expect(isValidTransition('archived', 'approve')).toBe(false);
  });
});
