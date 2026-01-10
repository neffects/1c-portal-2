# AI Agent Instructions

This document provides guidelines for AI agents (Cursor, Claude, etc.) working on the 1C Portal codebase.

## Before Starting Work

1. **Read `CONTEXT.md`** - Contains project overview, architecture, API endpoints, and current status
2. **Read the full ticket** - Understand acceptance criteria and scope
3. **Check existing patterns** - Look at similar files before implementing new features
4. **Pull latest** - Always `git pull` before starting work

## Project Structure

```
apps/worker/          # Cloudflare Worker API (Hono framework)
apps/web/             # Preact frontend with UnoCSS
packages/shared/      # Shared types, Zod schemas, constants
packages/xstate-machines/  # State machines for workflows
```

## Implementation Rules

### Code Style

- **Follow existing patterns exactly** - Match the style of adjacent code
- **Use TypeScript strictly** - No `any` types, proper type imports
- **Prefer existing abstractions** - Don't create new utilities unless necessary
- **Keep it simple** - Minimal changes to accomplish the task

### Naming Conventions

- Files: `kebab-case.ts` or `PascalCase.tsx` for components
- Functions: `camelCase`
- Types/Interfaces: `PascalCase`
- Constants: `SCREAMING_SNAKE_CASE`
- Entity IDs: 7-character lowercase alphanumeric (NanoID)

### Imports

```typescript
// External deps first
import { z } from 'zod';
import { Hono } from 'hono';

// Internal packages
import { EntityStatus, User } from '@1cc/shared';
import { entityMachine } from '@1cc/xstate-machines';

// Relative imports last
import { authMiddleware } from '../middleware/auth';
```

## Testing Requirements

### Before Creating a PR

```bash
# Run all tests
npm test

# Run linting
npm run lint

# Ensure no errors
```

### New Code Must Have Tests

| Code Type | Test Location | Test Framework |
|-----------|---------------|----------------|
| Worker routes | `apps/worker/src/routes/*.test.ts` | Vitest + Miniflare |
| Worker libs | `apps/worker/src/lib/*.test.ts` | Vitest |
| Shared schemas | `packages/shared/src/**/*.test.ts` | Vitest |
| XState machines | `packages/xstate-machines/src/*.test.ts` | Vitest |
| Preact components | `apps/web/src/**/*.test.tsx` | Vitest + Testing Library |
| E2E flows | `apps/web/e2e/*.spec.ts` | Playwright |

### Test Patterns

**Worker route tests** - Mock R2 bucket and environment:

```typescript
const mockR2 = {
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  list: vi.fn()
};

const mockEnv = {
  R2_BUCKET: mockR2,
  JWT_SECRET: 'test-secret-key-32-chars-minimum',
  ENVIRONMENT: 'test'
};
```

**Schema validation tests**:

```typescript
describe('createEntityRequestSchema', () => {
  it('should accept valid input', () => {
    const result = schema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('should reject invalid input', () => {
    const result = schema.safeParse(invalidInput);
    expect(result.success).toBe(false);
  });
});
```

## Git Workflow

### Branch Naming

```
feature/TIM-XXX-description
fix/TIM-XXX-description
hotfix/TIM-XXX-description
```

### Commit Messages

```
feat: Add entity export feature
fix: Resolve auth token refresh issue
test: Add missing entity route tests
docs: Update API documentation
```

### Creating a PR

1. Ensure all tests pass
2. Title: `TIM-XXX: Brief description`
3. Fill out the PR template completely
4. Link to Linear ticket

## API Patterns

### Response Format

All API responses use this structure:

```typescript
// Success
{ success: true, data: { ... } }

// Error
{ success: false, error: { code: 'ERROR_CODE', message: '...' } }
```

### Error Codes

- `VALIDATION_ERROR` - Invalid input data
- `UNAUTHORIZED` - Missing or invalid auth token
- `FORBIDDEN` - Insufficient permissions
- `NOT_FOUND` - Resource doesn't exist
- `CONFLICT` - Resource already exists

### Authentication

Routes under `/api/*` require JWT authentication. The auth middleware sets:

```typescript
c.get('userId')      // Current user ID
c.get('userRole')    // 'superadmin' | 'org_admin' | 'org_member'
c.get('organizationId')  // User's org ID (null for superadmin)
```

## Frontend Patterns

### Component Structure

```tsx
interface ComponentProps {
  // Props interface
}

export function Component({ prop1, prop2 }: ComponentProps) {
  // Component logic
  return (
    // JSX
  );
}
```

### Styling

- Use UnoCSS utility classes
- Follow existing class patterns in `styles/global.css`
- Dark mode: Use `dark:` prefix variants

### State Management

- Auth state: `stores/auth.tsx`
- Sync state: `stores/sync.tsx`
- Use Preact signals for reactivity

## Do NOT

- Add features beyond the ticket scope
- Refactor unrelated code
- Create new abstractions for one-time use
- Skip tests for new code
- Use `console.log` in production code (use `DEBUG` constant)
- Commit sensitive data or secrets
- Break existing tests

## Quick Reference

| Task | Command |
|------|---------|
| Start dev servers | `npm run dev` |
| Run all tests | `npm test` |
| Run worker tests | `npm test --workspace=@1cc/worker` |
| Run web tests | `npm test --workspace=@1cc/web` |
| Run E2E tests | `npm run test:e2e --workspace=@1cc/web` |
| Lint | `npm run lint` |
| Build | `npm run build` |

## Getting Help

- Check `CONTEXT.md` for project details
- Review existing implementations in similar files
- Look at test files for usage examples
- API docs are in route file comments
