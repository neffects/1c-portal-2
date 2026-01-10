/**
 * User Setup Machine Tests
 *
 * Tests for user authentication and setup flow state machine.
 */

import { describe, it, expect } from 'vitest';
import { createActor } from 'xstate';
import { userSetupMachine, getUserSetupStep, USER_SETUP_TOTAL_STEPS } from './user-machine';

describe('User Setup Machine', () => {
  describe('Initial state', () => {
    it('should start in emailEntry state', () => {
      const actor = createActor(userSetupMachine);
      actor.start();
      expect(actor.getSnapshot().value).toBe('emailEntry');
      actor.stop();
    });

    it('should have null context values initially', () => {
      const actor = createActor(userSetupMachine);
      actor.start();
      const context = actor.getSnapshot().context;
      expect(context.email).toBeNull();
      expect(context.token).toBeNull();
      expect(context.user).toBeNull();
      expect(context.organizationId).toBeNull();
      expect(context.role).toBeNull();
      expect(context.error).toBeNull();
      expect(context.isNewUser).toBe(false);
      actor.stop();
    });
  });

  describe('Email submission flow', () => {
    it('should transition to validating on SUBMIT_EMAIL', () => {
      const actor = createActor(userSetupMachine);
      actor.start();
      
      actor.send({ type: 'SUBMIT_EMAIL', email: 'test@example.com' });
      
      expect(actor.getSnapshot().value).toBe('validating');
      expect(actor.getSnapshot().context.email).toBe('test@example.com');
      actor.stop();
    });

    it('should transition to awaitingVerification on EMAIL_VALID', () => {
      const actor = createActor(userSetupMachine);
      actor.start();
      
      actor.send({ type: 'SUBMIT_EMAIL', email: 'test@example.com' });
      actor.send({ type: 'EMAIL_VALID' });
      
      expect(actor.getSnapshot().value).toBe('awaitingVerification');
      actor.stop();
    });

    it('should return to emailEntry with error on EMAIL_INVALID', () => {
      const actor = createActor(userSetupMachine);
      actor.start();
      
      actor.send({ type: 'SUBMIT_EMAIL', email: 'invalid' });
      actor.send({ type: 'EMAIL_INVALID', error: 'Invalid email format' });
      
      expect(actor.getSnapshot().value).toBe('emailEntry');
      expect(actor.getSnapshot().context.error).toBe('Invalid email format');
      actor.stop();
    });
  });

  describe('Magic link verification flow', () => {
    it('should transition to verifying on CLICK_MAGIC_LINK', () => {
      const actor = createActor(userSetupMachine);
      actor.start();
      
      actor.send({ type: 'SUBMIT_EMAIL', email: 'test@example.com' });
      actor.send({ type: 'EMAIL_VALID' });
      actor.send({ type: 'CLICK_MAGIC_LINK', token: 'abc123' });
      
      expect(actor.getSnapshot().value).toBe('verifying');
      expect(actor.getSnapshot().context.token).toBe('abc123');
      actor.stop();
    });

    it('should return to emailEntry on LINK_EXPIRED', () => {
      const actor = createActor(userSetupMachine);
      actor.start();
      
      actor.send({ type: 'SUBMIT_EMAIL', email: 'test@example.com' });
      actor.send({ type: 'EMAIL_VALID' });
      actor.send({ type: 'LINK_EXPIRED' });
      
      expect(actor.getSnapshot().value).toBe('emailEntry');
      expect(actor.getSnapshot().context.error).toContain('expired');
      actor.stop();
    });
  });

  describe('Verification success flow', () => {
    it('should go to orgAssignment for new user without org', () => {
      const actor = createActor(userSetupMachine.provide({
        guards: {
          needsOrgAssignment: () => true,
          hasOrganization: () => false
        }
      }));
      actor.start();
      
      actor.send({ type: 'SUBMIT_EMAIL', email: 'test@example.com' });
      actor.send({ type: 'EMAIL_VALID' });
      actor.send({ type: 'CLICK_MAGIC_LINK', token: 'abc123' });
      actor.send({ 
        type: 'VERIFICATION_SUCCESS', 
        user: { id: 'user123', email: 'test@example.com' } as any,
        isNewUser: true
      });
      
      expect(actor.getSnapshot().value).toBe('orgAssignment');
      expect(actor.getSnapshot().context.user).toBeDefined();
      expect(actor.getSnapshot().context.isNewUser).toBe(true);
      actor.stop();
    });

    it('should go to complete for existing user with org', () => {
      const actor = createActor(userSetupMachine.provide({
        guards: {
          needsOrgAssignment: () => false,
          hasOrganization: () => true
        }
      }));
      actor.start();
      
      actor.send({ type: 'SUBMIT_EMAIL', email: 'test@example.com' });
      actor.send({ type: 'EMAIL_VALID' });
      actor.send({ type: 'CLICK_MAGIC_LINK', token: 'abc123' });
      actor.send({ 
        type: 'VERIFICATION_SUCCESS', 
        user: { id: 'user123', email: 'test@example.com', organizationId: 'org123' } as any,
        isNewUser: false
      });
      
      expect(actor.getSnapshot().value).toBe('complete');
      actor.stop();
    });

    it('should return to emailEntry on VERIFICATION_FAILED', () => {
      const actor = createActor(userSetupMachine);
      actor.start();
      
      actor.send({ type: 'SUBMIT_EMAIL', email: 'test@example.com' });
      actor.send({ type: 'EMAIL_VALID' });
      actor.send({ type: 'CLICK_MAGIC_LINK', token: 'abc123' });
      actor.send({ type: 'VERIFICATION_FAILED', error: 'Token expired' });
      
      expect(actor.getSnapshot().value).toBe('emailEntry');
      expect(actor.getSnapshot().context.error).toBe('Token expired');
      actor.stop();
    });
  });

  describe('Organization assignment flow', () => {
    it('should transition to complete on ASSIGN_ORG', () => {
      const actor = createActor(userSetupMachine.provide({
        guards: {
          needsOrgAssignment: () => true,
          hasOrganization: () => false
        }
      }));
      actor.start();
      
      actor.send({ type: 'SUBMIT_EMAIL', email: 'test@example.com' });
      actor.send({ type: 'EMAIL_VALID' });
      actor.send({ type: 'CLICK_MAGIC_LINK', token: 'abc123' });
      actor.send({ 
        type: 'VERIFICATION_SUCCESS', 
        user: { id: 'user123' } as any,
        isNewUser: true
      });
      
      expect(actor.getSnapshot().value).toBe('orgAssignment');
      
      actor.send({ type: 'ASSIGN_ORG', organizationId: 'org456', role: 'org_member' });
      
      expect(actor.getSnapshot().value).toBe('complete');
      expect(actor.getSnapshot().context.organizationId).toBe('org456');
      expect(actor.getSnapshot().context.role).toBe('org_member');
      actor.stop();
    });

    it('should transition to complete on SKIP_ORG', () => {
      const actor = createActor(userSetupMachine.provide({
        guards: {
          needsOrgAssignment: () => true,
          hasOrganization: () => false
        }
      }));
      actor.start();
      
      actor.send({ type: 'SUBMIT_EMAIL', email: 'test@example.com' });
      actor.send({ type: 'EMAIL_VALID' });
      actor.send({ type: 'CLICK_MAGIC_LINK', token: 'abc123' });
      actor.send({ 
        type: 'VERIFICATION_SUCCESS', 
        user: { id: 'user123' } as any,
        isNewUser: true
      });
      actor.send({ type: 'SKIP_ORG' });
      
      expect(actor.getSnapshot().value).toBe('complete');
      expect(actor.getSnapshot().context.organizationId).toBeNull();
      actor.stop();
    });
  });

  describe('Reset flow', () => {
    it('should reset to emailEntry on RESET from any state', () => {
      const actor = createActor(userSetupMachine);
      actor.start();
      
      actor.send({ type: 'SUBMIT_EMAIL', email: 'test@example.com' });
      actor.send({ type: 'EMAIL_VALID' });
      
      expect(actor.getSnapshot().value).toBe('awaitingVerification');
      expect(actor.getSnapshot().context.email).toBe('test@example.com');
      
      actor.send({ type: 'RESET' });
      
      expect(actor.getSnapshot().value).toBe('emailEntry');
      expect(actor.getSnapshot().context.email).toBeNull();
      expect(actor.getSnapshot().context.token).toBeNull();
      expect(actor.getSnapshot().context.error).toBeNull();
      actor.stop();
    });
  });
});

describe('getUserSetupStep', () => {
  it('should return step 1 for email states', () => {
    expect(getUserSetupStep('emailEntry')).toBe(1);
    expect(getUserSetupStep('validating')).toBe(1);
  });

  it('should return step 2 for verification states', () => {
    expect(getUserSetupStep('awaitingVerification')).toBe(2);
    expect(getUserSetupStep('verifying')).toBe(2);
  });

  it('should return step 3 for org assignment', () => {
    expect(getUserSetupStep('orgAssignment')).toBe(3);
  });

  it('should return step 4 for complete', () => {
    expect(getUserSetupStep('complete')).toBe(4);
  });

  it('should return step 1 for unknown states', () => {
    expect(getUserSetupStep('unknown')).toBe(1);
  });
});

describe('USER_SETUP_TOTAL_STEPS', () => {
  it('should be 4', () => {
    expect(USER_SETUP_TOTAL_STEPS).toBe(4);
  });
});
