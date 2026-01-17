# AI Agent Instructions

This document provides guidelines for AI agents (Cursor, Claude, etc.) working on the 1C Portal codebase.

## Before Starting Work

1. **Read `CONTEXT.md`** - Contains project overview, architecture, API endpoints, and current status
2. **Read the full ticket** - Understand acceptance criteria and scope
3. **Check existing patterns** - Look at similar files before implementing new features
4. **Pull latest** - Always `git pull` before starting work
5. **Start development servers** - Always start servers before beginning work (see Server Management below)

## Server Management

### CRITICAL Rules - READ CAREFULLY

1. **Servers MUST run in the Cursor terminal window** - NEVER run servers in background mode
2. **NEVER use `is_background: true`** - This hides the console output which is needed for debugging (e.g., magic links)
3. **Fixed ports are required** - Servers must always run on the same ports:
   - Worker API: `http://localhost:8787`
   - Web Frontend: `http://localhost:5173`
4. **Kill existing processes before starting** - Always ensure ports are free before starting servers
5. **The user must be able to see server logs** - Magic links, errors, and debugging info appear in the terminal

### Starting Servers (CORRECT WAY)

**Step 1: Kill any existing processes on the required ports**
```bash
# Kill processes on both ports (run this first)
lsof -ti:8787 | xargs kill -9 2>/dev/null; lsof -ti:5173 | xargs kill -9 2>/dev/null
```

**Step 2: Start servers in the Cursor terminal window**

The user should run this command themselves in their terminal, OR the agent should instruct them to do so:
```bash
npm run dev
```

This starts both servers with visible output in the terminal.

**Individual servers:**
```bash
npm run dev:worker   # API server on port 8787
npm run dev:web      # Frontend on port 5173
```

### FORBIDDEN - Do NOT do this

```typescript
// ❌ WRONG - Never use is_background: true for dev servers
Shell({ command: "npm run dev", is_background: true })

// ❌ WRONG - Never use & to background the process
Shell({ command: "npm run dev &" })
```

### WHY this matters

- The worker outputs **magic links** for authentication - users need to see these
- Error messages and stack traces appear in the terminal
- Hot reload status is shown in the terminal
- The user cannot debug issues if they can't see the server output

### Restarting Servers

Tell the user to run in their terminal:
```bash
# Kill existing and restart all servers
lsof -ti:8787 | xargs kill -9 2>/dev/null; lsof -ti:5173 | xargs kill -9 2>/dev/null; npm run dev
```

Or for individual servers:
```bash
# Restart worker only
lsof -ti:8787 | xargs kill -9 2>/dev/null; npm run dev:worker

# Restart web only  
lsof -ti:5173 | xargs kill -9 2>/dev/null; npm run dev:web
```

### Port Configuration

Ports are configured in:
- **Worker**: `apps/worker/wrangler.toml` - `[dev]` section sets `port = 8787`
- **Web**: `apps/web/vite.config.ts` - `server.port = 5173` with `strictPort: true`

These ports must remain fixed and should not be changed without updating all configuration files and documentation.

**Port enforcement**:
- Vite is configured with `strictPort: true` - it will fail (not try another port) if 5173 is in use
- Wrangler uses port 8787 by default and will fail if already in use
- Always kill existing processes before starting servers to avoid port conflicts

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

## API and Route Changes

**CRITICAL**: When modifying API endpoints or routes, you MUST:

1. **Search for all consumers** - Use `grep` to find all frontend code that calls the endpoint:
   ```bash
   grep -r "/api/endpoint-name" apps/web/src
   ```

2. **Update all consumers** - Update every file that uses the changed endpoint:
   - Check route paths, request/response formats, error handling
   - Update TypeScript types if response structure changed
   - Test all affected UI components

3. **Update documentation** - ALWAYS keep documentation in sync:
   - **CONTEXT.md**: Update API endpoint lists and route descriptions
   - **API.md**: Update endpoint documentation with:
     - Correct route path
     - Request/response formats
     - Authentication requirements
     - Error responses
     - Usage notes (e.g., "Org admins use X, superadmins use Y")

4. **Verify consistency** - Ensure documentation reflects how the system **should** work, not just current implementation:
   - Check route structure matches API.md route table
   - Verify endpoint purposes match documentation
   - Confirm access control matches documented auth levels

5. **Check for deprecated endpoints** - If removing or deprecating an endpoint:
   - Remove from CONTEXT.md
   - Remove or mark as deprecated in API.md
   - Update all consumers to use the correct replacement endpoint

**Example workflow for route changes**:
1. Modify route handler in `apps/worker/src/routes/`
2. Search: `grep -r "/api/old-route" apps/web/src`
3. Update all found files
4. Update CONTEXT.md endpoint list
5. Update API.md endpoint documentation
6. Verify documentation matches intended behavior

## Do NOT

- Add features beyond the ticket scope
- Refactor unrelated code
- Create new abstractions for one-time use
- Skip tests for new code
- Use `console.log` in production code (use `DEBUG` constant)
- Commit sensitive data or secrets
- Break existing tests
- Change API endpoints without updating all consumers and documentation
- **NEVER add fallbacks/workarounds** - If data is missing (e.g., entity in bundle but no stub/file), that's a data integrity problem that should be fixed, not worked around. Report the issue clearly instead of hiding it with fallback logic.

## Quick Reference

| Task | Command |
|------|---------|
| Start dev servers | `npm run dev` (runs in terminal, NOT background) |
| Restart servers | `npm run restart` |
| Restart worker only | `npm run restart:worker` |
| Restart web only | `npm run restart:web` |
| Run all tests | `npm test` |
| Run worker tests | `npm test --workspace=@1cc/worker` |
| Run web tests | `npm test --workspace=@1cc/web` |
| Run E2E tests | `npm run test:e2e --workspace=@1cc/web` |
| Lint | `npm run lint` |
| Build | `npm run build` |

**Server URLs**:
- Worker API: `http://localhost:8787`
- Web Frontend: `http://localhost:5173`

## Getting Help

- Check `CONTEXT.md` for project details
- Review existing implementations in similar files
- Look at test files for usage examples
- API docs are in route file comments
