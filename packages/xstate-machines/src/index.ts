/**
 * @1cc/xstate-machines - State machines for 1C Portal workflows
 * 
 * This package contains XState machine definitions for:
 * - Entity lifecycle (draft -> pending -> published -> archived)
 * - User setup flow (email verification -> org assignment)
 * - Organization creation wizard
 */

export * from './entity-machine';
export * from './user-machine';
export * from './organization-machine';

// Debug logging
console.log('[xstate-machines] Package loaded');
