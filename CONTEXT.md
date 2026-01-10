# 1C Portal - Project Context

## Overview

1C Portal is a multi-tenant content management system (CMS) built on Cloudflare's edge infrastructure. It enables organizations to create, manage, and publish content with sophisticated access controls and approval workflows.

## Architecture

### Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Backend | Cloudflare Workers | Stateless API endpoints, XState workflows |
| Storage | Cloudflare R2 | Versioned JSON files, manifests, bundles |
| Frontend | Preact + UnoCSS | Lightweight, fast UI with utility-first CSS |
| Client Data | Local caching via signals | Reactive data management |
| Auth | Magic Links + JWT | Passwordless authentication |
| Workflows | XState | State machines for entity/user/org flows |

### Project Structure

```
1cc-portal-2/
├── apps/
│   ├── worker/           # Cloudflare Worker API
│   │   ├── src/
│   │   │   ├── routes/   # API route handlers
│   │   │   ├── middleware/ # Auth, error handling
│   │   │   ├── lib/      # Utilities (auth, r2, id, email)
│   │   │   └── index.ts  # Worker entry point
│   │   └── wrangler.toml
│   └── web/              # Preact frontend
│       ├── src/
│       │   ├── components/
│       │   ├── pages/
│       │   ├── stores/   # Auth and sync state
│       │   └── main.tsx
│       └── vite.config.ts
├── packages/
│   ├── shared/           # Shared types and schemas
│   └── xstate-machines/  # XState workflow definitions
├── package.json          # Workspace root
└── turbo.json            # Turborepo config
```

## Key Concepts

### User Roles

- **Superadmin**: Platform-wide access, manages entity types and organizations
- **Org Admin**: Content management within their organization
- **Org Member**: View-only access to published content

### Entity Lifecycle

```
Draft → Pending → Published → Archived
         ↓
       Draft (rejected)
```

### Visibility Scopes

- **Public**: Accessible to everyone, SEO indexable
- **Authenticated**: All logged-in users on the platform
- **Members**: Organization members only

### Storage Structure (R2)

```
config/app.json           # App configuration
public/                   # Public content
platform/                 # Platform content
private/orgs/{orgId}/     # Organization-specific content
stubs/{entityId}.json     # Entity ownership lookup
secret/ROOT.json          # Root config
```

## API Endpoints

### Authentication
- `POST /auth/magic-link` - Request magic link
- `GET /auth/verify` - Verify token
- `POST /auth/refresh` - Refresh JWT
- `GET /auth/me` - Get current user

### Organizations
- `POST /api/organizations` - Create org (superadmin)
- `GET /api/organizations` - List orgs
- `PATCH /api/organizations/:id` - Update org
- `PATCH /api/organizations/:id/permissions` - Update entity type permissions
- `POST /api/organizations/:id/users/invite` - Invite user to org (superadmin)

### Entity Types
- `POST /api/entity-types` - Create type (superadmin)
- `GET /api/entity-types` - List types
- `PATCH /api/entity-types/:id` - Update type

### Entities
- `POST /api/entities` - Create entity
- `GET /api/entities` - List entities
- `GET /api/entities/:id` - Get entity
- `PATCH /api/entities/:id` - Update entity (atomic merge)
- `POST /api/entities/:id/transition` - Status transition

### Users
- `POST /api/users/invite` - Invite user
- `GET /api/users` - List users
- `PATCH /api/users/:id/role` - Change role
- `GET /api/users/me/flags` - Get flagged entities

### Manifests
- `GET /manifests/public` - Public manifest
- `GET /manifests/platform` - Platform manifest
- `GET /manifests/bundles/:visibility/:typeId` - Entity bundle

## Development

### Running Locally

```bash
# Install dependencies
npm install

# Start all services
npm run dev

# Start worker only
npm run dev:worker

# Start frontend only  
npm run dev:web
```

### Environment Variables

Worker secrets (set via `wrangler secret`):
- `JWT_SECRET` - JWT signing key
- `RESEND_API_KEY` - Email service API key
- `SUPERADMIN_EMAILS` - Comma-separated list of superadmin emails

### Testing

```bash
# Run all tests
npm test

# Run tests with coverage
npm test -- --coverage

# Run worker tests only
npm run test --workspace=@1cc/worker

# Run frontend component tests
npm run test --workspace=@1cc/web

# Run E2E tests (requires running server)
npm run test:e2e --workspace=@1cc/web

# Run security tests
npm run test:security --workspace=@1cc/worker
```

### Deployment

```bash
# Deploy worker to staging
wrangler deploy --env staging

# Deploy worker to production
wrangler deploy --env production

# Build frontend
npm run build
```

## CI/CD Pipeline

### Environments

| Environment | Worker Name | R2 Bucket | Trigger |
|-------------|-------------|-----------|---------|
| Development | Local | Mock R2 | Local dev |
| Staging | `1cc-portal-api-staging` | `1cc-portal-data-staging` | Push to `develop` |
| Production | `1cc-portal-api-prod` | `1cc-portal-data-prod` | Push to `main` |

### GitHub Actions Workflows

| Workflow | Purpose | Trigger |
|----------|---------|---------|
| `ci.yml` | Lint, test, build | All PRs, pushes to main/develop |
| `deploy-staging.yml` | Deploy to staging + E2E + security scans | Push to `develop` |
| `deploy-production.yml` | Deploy to production + smoke tests | Push to `main` |
| `e2e.yml` | Playwright E2E tests | Called by deploy workflows |
| `security.yml` | ZAP + Nuclei security scans | Called by deploy, weekly schedule |

### Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `CLOUDFLARE_API_TOKEN` | Wrangler deployments |
| `CLOUDFLARE_ACCOUNT_ID` | Account identifier |
| `JWT_SECRET_STAGING` | JWT signing key for staging |
| `JWT_SECRET_PRODUCTION` | JWT signing key for production |
| `RESEND_API_KEY_STAGING` | Email API key for staging |
| `RESEND_API_KEY_PRODUCTION` | Email API key for production |
| `SUPERADMIN_EMAILS` | Comma-separated admin emails |

### Branching Strategy (Gitflow)

- `main` - Production-ready code
- `develop` - Integration branch, deploys to staging
- `feature/*` - Feature branches, merged to develop
- `hotfix/*` - Critical fixes, merged to main and develop

## Security

### Automated Security Testing

The project includes automated security testing with:

1. **Unit Security Tests** (`apps/worker/security/tests/`)
   - Authentication bypass attempts
   - Authorization/IDOR prevention
   - Input validation and injection prevention

2. **OWASP ZAP** (`apps/worker/security/zap/`)
   - API scanning for common vulnerabilities
   - Custom rule configuration
   - SARIF reports for GitHub Security tab

3. **Nuclei Templates** (`apps/worker/security/nuclei/templates/`)
   - Auth bypass detection
   - IDOR testing
   - Privilege escalation testing
   - Injection vulnerability detection

### Security Best Practices

- All routes require authentication except public manifests
- JWT tokens verified with constant-time comparison
- Magic links are single-use with 15-minute expiration
- R2 keys validated against path traversal
- User input sanitized against XSS
- File uploads validated for type and size
- Rate limiting on authentication endpoints
- CORS configured per environment
- Security headers enforced (CSP, X-Frame-Options, etc.)

## Current Status

### Completed
- ✅ Project structure and configuration
- ✅ Shared types and validation schemas
- ✅ XState workflow machines
- ✅ Worker API with all routes
- ✅ Authentication system (magic links + JWT)
- ✅ Organization management
- ✅ Entity type management
- ✅ Entity CRUD with versioning
- ✅ User management and invitations
- ✅ Manifest and bundle generation
- ✅ Frontend core pages
- ✅ Admin module pages
- ✅ Superadmin module pages

### Pending
- 🔲 R2 bucket initialization
- 🔲 TanStack DB integration for true offline
- 🔲 Alert notification system (email digests)
- 🔲 Performance optimization

### Recently Completed (CI/CD & Testing)
- ✅ Multi-environment configuration (2026-01-10):
  - Complete staging and production environment setup in wrangler.toml
  - Separate R2 buckets per environment
  - Environment-specific API and frontend URLs
- ✅ GitHub Actions CI/CD pipeline:
  - CI workflow with linting, testing, and build verification
  - Staging deployment on push to develop branch
  - Production deployment on push to main branch
  - E2E testing workflow with Playwright
  - Security scanning workflow with ZAP and Nuclei
- ✅ Comprehensive test coverage:
  - Worker unit tests for all routes (entities, entity-types, users, manifests)
  - Auth middleware tests
  - Frontend Vitest configuration with jsdom
  - Playwright E2E tests for auth, entity CRUD, and admin flows
- ✅ Security testing infrastructure:
  - Security test suite (auth bypass, authz, injection prevention)
  - OWASP ZAP API scanning configuration
  - Custom Nuclei templates for 1CC-specific vulnerabilities
  - Automated penetration testing in CI/CD

### Recently Completed
- ✅ Simplified user management with email autocomplete (2026-01-10):
  - Single "Add Member" form with email autocomplete for existing users
  - As you type, suggestions show existing users (including superadmins)
  - Selecting a suggestion auto-fills the email
  - Existing users are added immediately; new users receive an invitation email
  - Removed separate "Add Existing User" modal - integrated into single form
  - Frontend now properly handles both cases:
    - Existing user: Shows "X added to organization", refreshes members list instantly
    - New user: Shows "Invitation sent to X"
  - API: POST /api/organizations/:id/users/invite handles both cases automatically
  - API: GET /api/users/all provides autocomplete suggestions
- ✅ Invite flow now adds existing users directly (2026-01-10):
  - POST /api/organizations/:id/users/invite now checks if user exists in system
  - If user exists: creates membership record on R2 immediately (no invitation needed)
  - If user doesn't exist: sends invitation email with magic link (existing behavior)
  - Response includes `existingUser: true/false` to indicate which path was taken
- ✅ Organization member management in superadmin (2026-01-10):
  - Edit modal now has tabs: "Settings" and "Members"
  - Members tab shows all organization users with their roles
  - Invite new users with email and role selection (Admin or Member)
  - Change existing user roles via dropdown
  - Remove users with confirmation dialog
  - Uses existing API endpoints: GET /api/users?orgId, POST /api/organizations/:id/users/invite, PATCH /api/users/:id/role, DELETE /api/users/:id
- ✅ Organization edit functionality (2026-01-10):
  - Edit button in OrgManager now opens edit modal with organization details
  - Edit modal allows updating: name, slug, description, domain whitelist, self-signup setting
  - Uses `PATCH /api/organizations/:id` endpoint for saving changes
  - Full error handling and loading states
- ✅ Organization creation wizard fully integrated (2026-01-10):
  - OrgManager now uses full OrgWizard component (replaces placeholder modal)
  - Multi-step wizard: Basic Info → Domains → Permissions → Admin → Review
  - Auto-generated slugs from organization name
  - Domain whitelist configuration for self-signup
  - Entity type permissions selection (viewable/creatable)
  - Optional admin invitation on creation
  - Added `POST /api/organizations/:id/users/invite` route for superadmin user invites
- ✅ Type builder visual interface (TypeBuilder.tsx) - Full-featured visual editor for creating/editing entity types with:
  - Field type selector with icons and descriptions
  - Section management with reordering
  - Field constraints editor (min/max, options, file types, link targets)
  - Preview panel showing form layout
  - Auto-generated slugs and plural names
  - Default built-in fields: Name and Slug (locked, cannot be removed)
- ✅ Simplified visibility system:
  - Renamed visibility scopes: 'public' | 'authenticated' | 'members' (was platform/private)
  - Removed redundant allowPublic checkbox from entity types
  - Visibility now controlled by single dropdown (no checkbox duplication)
- ✅ Bug fixes (2026-01-10):
  - Fixed `allFields` undefined error in TypeBuilder.tsx PreviewPanel component
  - Fixed double sync calls on page load in SyncProvider (now uses ref to track initial sync)
  - Sync store now properly deduplicates initial sync vs auth-change sync
  - Fixed OrgWizard permissions step not showing entity types - now fetches from API instead of sync store manifest
  - Fixed AdminDashboard not showing entity types for org admins:
    - Dashboard now fetches from `/api/entity-types?permission=creatable` instead of sync store
    - Added `permission` query param to entity-types API ('viewable' or 'creatable')
    - Viewable = types org can view/browse, Creatable = types org can create entities for
  - Fixed SuperadminDashboard entity type count showing zero (NEF-5):
    - Dashboard now fetches entity types directly from `/api/entity-types` API
    - Previously relied on sync store manifest which only includes types with published entities
    - Superadmins now see accurate count of all defined entity types regardless of entity count

## Notes

- Entity IDs are 7-character NanoID (lowercase alphanumeric)
- All timestamps use ISO 8601 format
- Entity updates use atomic field merging (only changed fields sent)
- Explicit save model - no auto-save
- Bundles are pre-aggregated for fast client sync
