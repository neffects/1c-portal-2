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
| Client Data | TanStack DB + Query (ETag-based sync) | Offline-first local storage with reactive queries |
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

**Status Transitions:**
- `submitForApproval`: draft → pending
- `approve`: pending → published
- `reject`: pending → draft
- `archive`: published → archived
- `restore`: archived/deleted → draft
- `delete`: draft → deleted (soft delete - entity data preserved)
- `superDelete`: Any status → permanently removed (superadmin only - hard delete)

**Note**: `superDelete` is a superadmin-only action that permanently removes all entity data from R2 storage. It can be called from any status and cannot be undone.

### Membership Keys (Access Control)

The system uses **config-driven membership keys** defined in `app.json` to control content visibility:

- **Membership Keys**: Defined in `app.json` under `membershipKeys.keys`
  - Each key has: `id`, `name`, `description`, `requiresAuth`, `order`
  - Default keys: `public`, `platform`, `member`
  - **The `public` key is always present by default** - it cannot be deleted and will be automatically added if missing from config
  
- **Organization Tiers**: Defined in `app.json` under `membershipKeys.organizationTiers`
  - Each tier grants specific membership keys to users
  - `platform` tier: grants `public` + `platform` keys
  - `full_member` tier: grants `public` + `platform` + `member` keys

- **Entity Type Visibility**: Each entity type has `visibleTo` array (membership key IDs)
  - Controls which keys can see entities of this type
  - Field-level visibility: `fieldVisibility` overrides per field

- **Bundle Structure**: Bundles are generated per membership key
  - Global: `bundles/{keyId}/{typeId}.json` (published, field-projected)
  - Org member: `bundles/org/{orgId}/member/{typeId}.json` (published, all fields)
  - Org admin: `bundles/org/{orgId}/admin/{typeId}.json` (draft+deleted, all fields)

### Multi-Organization Authentication Architecture

The system supports users belonging to multiple organizations with different roles:

```
JWT Token (Minimal):
├── sub: userId
└── email: user@example.com
    (NO organization or role info - looked up per request)

User-Org Stubs (R2):
└── private/user-stubs/
    └── [email-hash]-[user-id]-[org-id]-[role].json
        ├── Fast membership check (file existence)
        └── Role encoded in filename

Auth Flow:
1. User logs in with email
2. JWT created with just sub + email
3. /auth/me returns all user's organizations
4. Frontend stores orgs, tracks currentOrganizationId
5. API calls include orgId in payload
6. Middleware checks user-org stub exists
```

**Key points:**
- JWT is user-level, not organization-specific
- Organization context is client-side (switchable without re-auth)
- User-org stubs enable fast O(1) membership checks
- Role is per-organization, stored in stub filename
- Superadmins identified by email in SUPERADMIN_EMAILS env var

### Storage Structure (R2)

```
config/app.json           # App configuration (includes membershipKeys config)
public/                   # Public content (entities with public visibility)
platform/                 # Platform content (entities with authenticated visibility)
private/orgs/{orgId}/     # Organization-specific content
private/user-stubs/       # User-org membership stubs (for fast lookup)
stubs/{entityId}.json     # Entity ownership lookup
secret/ROOT.json          # Root config

bundles/
├── {keyId}/{typeId}.json          # Global bundles per membership key (published, field-projected)
│   ├── public/{typeId}.json       # Public bundle
│   ├── platform/{typeId}.json     # Platform bundle
│   └── member/{typeId}.json       # Member bundle
└── org/{orgId}/
    ├── member/{typeId}.json       # Org published entities (all fields)
    └── admin/{typeId}.json        # Org draft+deleted entities (all fields)

manifests/
├── {keyId}/site.json              # Global manifests per membership key
└── org/{orgId}/
    ├── member/site.json           # Org member manifest
    └── admin/site.json            # Org admin manifest
```

### R2 Access Security (CASL-Protected)

**CRITICAL**: All R2 storage access is CASL-protected. There is no way to bypass CASL authorization when accessing R2.

**Single-Function Access Layer:**
- All R2 operations go through CASL-aware functions in `lib/r2-casl.ts`
- Routes and helpers import from `lib/r2.ts`, which re-exports CASL-aware functions
- Direct `bucket.get()`, `bucket.put()`, `bucket.delete()`, `bucket.head()`, or `bucket.list()` calls are **forbidden** outside of `lib/r2-casl.ts`
- The CASL layer enforces permissions before any R2 operation executes

**CASL-Aware Functions:**
- `readJSON()` - Read JSON files with CASL permission check
- `readJSONWithEtag()` - Read JSON with ETag for conditional requests
- `writeJSON()` - Write JSON files with CASL permission check + automatic bundle invalidation
- `deleteFile()` - Delete files with CASL permission check
- `fileExists()` - Check file existence with CASL permission check
- `headFile()` - Get file metadata with CASL permission check
- `listFiles()` - List files with CASL permission check
- `listFilesPaginated()` - List files with pagination and CASL permission check
- `writeFile()` - Write binary files (uploads) with CASL permission check
- `readFile()` - Read binary files with CASL permission check
- `checkETag()` - Low-cost ETag check with CASL permission check

**Path-to-Permission Mapping:**
- `entities/` and `stubs/` paths → `Entity` subject
- `entity-types/` paths → `EntityType` subject
- `orgs/*/profile.json` paths → `Organization` subject
- `orgs/*/users/*` paths → `User` subject
- `bundles/` paths → `Entity` subject (bundles contain entities)
- `manifests/` paths → `Platform` subject
- `uploads/` paths → `Platform` subject (file management)
- `config/` and `secret/` paths → `Platform` subject (system config)
- `public/` paths → `Entity` subject (public entities, but still CASL-checked)

**Defense in Depth:**
1. **Route Level**: `requireAbility()` middleware checks permissions before route handlers execute
2. **R2 Level**: CASL-aware functions verify permissions again before R2 operations
3. **Automatic Bundle Invalidation**: `writeJSON()` automatically triggers bundle regeneration when entities change

**Security Guarantee:**
- No route or helper function can bypass CASL
- All R2 access requires a valid `AppAbility` object (from JWT context)
- Permission checks happen at the data access layer, not just route level
- Even if route middleware is bypassed, R2 operations are still protected

## API Endpoints

### Route Structure

Routes are organized by access level and map directly to R2 storage paths:

- `/public/*` - Public routes (no auth) → `public/` in R2
- `/api/*` - Authenticated routes → `platform/` in R2
- `/api/user/*` - User-specific routes → `private/users/:userId/` in R2
- `/api/orgs/:orgId/*` - Org-scoped routes → `private/orgs/:orgId/` in R2
- `/api/super/*` - Superadmin routes → `private/`, `config/`, `secret/` in R2

### Deep Linking

SEO-friendly URLs using slugs:
- `/:orgSlug` - Organization landing page
- `/:orgSlug/:typeSlug` - List entities of type in org
- `/:orgSlug/:typeSlug/:entitySlug` - Get specific entity by slug chain

Slug indexes stored at `stubs/slug-index/{orgId}-{typeSlug}-{entitySlug}.json` for fast lookups.

### Authentication
- `POST /auth/magic-link` - Request magic link
- `GET /auth/verify` - Verify token
- `POST /auth/refresh` - Refresh JWT
- `GET /api/user/me` - Get current user (moved from /auth/me)

### Public Routes
- `GET /public/branding` - Get platform branding config
- `GET /public/manifests/site` - Get public site manifest
- `GET /public/bundles/:typeId` - Get public entity bundle
- `GET /public/entities/:id` - Get public entity by ID
- `GET /:orgSlug/:typeSlug/:entitySlug` - Deep link to entity

### Authenticated Routes
- `GET /api/manifests/site` - Get manifest for user's highest membership key
- `GET /api/bundles/:typeId` - Get bundle for user's highest membership key (field-projected)
- `GET /api/entities` - List entities (platform content)
- `GET /api/entities/:id` - Get entity by ID (field-projected based on user's keys)
- `GET /api/entity-types` - List entity types

### User Routes
- `GET /api/user/me` - Get current user info
- `GET /api/user/preferences` - Get user preferences
- `PATCH /api/user/preferences` - Update preferences
- `GET /api/user/flags` - Get flagged entities
- `POST /api/user/flags` - Flag an entity
- `DELETE /api/user/flags/:entityId` - Unflag an entity

### Organization Routes (Authenticated)
- `GET /api/organizations` - List organizations (superadmin: all orgs, others: own org)
- `GET /api/organizations/:id` - Get organization details
- `PATCH /api/organizations/:id` - Update organization
- `POST /api/organizations/:id/users/invite` - Invite user to organization
- `POST /api/organizations/:id/users/add` - Add existing user to organization
- `GET /api/organizations/:id/permissions` - Get entity type permissions for org
- `PATCH /api/organizations/:id/permissions` - Update entity type permissions for org
- `POST /api/organizations` - Create organization (superadmin only)
- `DELETE /api/organizations/:id` - Soft delete organization (superadmin only)

### Organization-Scoped Routes
- `POST /api/orgs/:orgId/entities` - Create entity in org
- `GET /api/orgs/:orgId/entities` - List entities in org
- `GET /api/orgs/:orgId/entities/:id` - Get entity by ID in org (all fields for org's own content)
- `GET /api/orgs/:orgId/users` - List users in org
- `GET /api/orgs/:orgId/manifests/site` - Get org manifest (member or admin based on role)
- `GET /api/orgs/:orgId/bundles/:typeId` - Get org bundle (member or admin based on role)

### Entity Type Routes
- `GET /api/entity-types` - List entity types (authenticated users)
- `GET /api/entity-types/:id` - Get entity type definition (authenticated users)
- `PATCH /api/entity-types/:id` - Update entity type (superadmin only)
- `POST /api/entity-types` - Create entity type (superadmin only)
- `DELETE /api/entity-types/:id` - Archive entity type (superadmin only, soft delete)
- `DELETE /api/entity-types/:id/hard` - Permanently delete entity type (superadmin only, hard delete)

### Superadmin Routes
- `POST /api/super/organizations` - Create organization (alternative endpoint)
- `GET /api/super/organizations` - List all organizations (alternative endpoint)
- `POST /api/super/entity-types` - Create entity type (alternative endpoint)
- `PATCH /api/super/platform/branding` - Update platform branding
- `POST /api/super/entities` - Create entity (supports global entities)
- `GET /api/super/entities` - List entities (all orgs + global)
- `GET /api/super/entities/export` - Export entities for a type (query: typeId, status?, organizationId?)
- `POST /api/super/entities/bulk-import` - Atomic bulk import entities with versioning support
- `GET /api/super/entities/:id` - Get any entity by ID (global or org-scoped)
- `PATCH /api/super/entities/:id` - Update any entity by ID (global or org-scoped, draft status only)
- `POST /api/super/entities/:id/transition` - Status transition for any entity (delete, archive, approve, superDelete, etc.)
- `GET /api/super/bundles` - List all bundles with metadata (size, generation time, version)

### Import/Export (Superadmin)

The import/export functionality allows superadmins to bulk manage entities:

- **Export**: `GET /api/super/entities/export?typeId=xxx`
  - Returns entity type schema + all entities of that type
  - Optional filters: `status`, `organizationId` (null for global entities)
  
- **Bulk Import**: `POST /api/super/entities/bulk-import`
  - Atomic operation: all-or-nothing (validation errors abort entire batch)
  - Supports versioning: empty `id` creates new, existing `id` creates new version
  - Per-row `organizationId` and `slug` override request-level defaults
  - Validates slug uniqueness per (entityType, org, slug) for new entities

- **Import Preview** (2026-01-15):
  - After file upload and validation, shows a preview table of entities to be imported
  - Displays: row number (CSV row), name, slug, and up to 5 additional fields from the entity type
  - Highlights rows with validation errors in red
  - Shows status badge (Ready/Error) for each entity
  - Helps users verify data before importing
  - Location: `apps/web/src/pages/superadmin/EntityImportExport.tsx`

**Note (2026-01-14)**: Fixed missing `/api/organizations` endpoint:
- **Bug fix**: Added missing mount for `organizationRoutes` in `/api` routes aggregator. The routes existed in `routes/organizations.ts` but were not mounted, causing 404 errors when the frontend called `GET /api/organizations`. The routes are now properly mounted at `/api/organizations`.

**Note (2026-01-11)**: Fixed organization listing bug and superadmin organization assignment:
- **Bug fix**: Auth middleware now sets `userRole` to 'superadmin' for superadmin users. Previously `userRole` was undefined, causing the listing endpoint to return early with empty results.
- **Creation**: Verifies organization file is written and readable immediately after creation, logs file paths
- **Slug uniqueness check**: Enhanced `findOrgBySlug` with improved filtering logic (matching listing endpoint) and detailed logging
- **Listing**: Logs prefix used, all files returned from R2, filtering logic, and final profile files
- **Frontend**: Logs API response, organization IDs received, and detailed error messages
- This fixes the issue where newly created organizations weren't appearing in the list
- Also helps debug 409 Conflict errors when creating organizations (slug uniqueness checks)
- **Superadmin org assignment fix**: Auth store now ensures superadmins with multiple organizations always have a default organization selected (first org if none selected). Dashboard shows organization switcher when multiple orgs are available.

### Entity Types
- `POST /api/entity-types` - Create type (superadmin)
- `GET /api/entity-types` - List types
- `PATCH /api/entity-types/:id` - Update type

### Entities
- `GET /api/entities` - List entities (authenticated platform content)
- `GET /api/entities/:id` - Get entity (with access control)
- `PATCH /api/entities/:id` - Update entity (atomic merge)
- `POST /api/entities/:id/transition` - Status transition

**Note**: For creating entities:
- Org admins: Use `POST /api/orgs/:orgId/entities`
- Superadmins: Use `POST /api/super/entities` (supports global entities with `organizationId: null`)

**Entity Request Structure** (Updated 2026-01-15):
- `name` and `slug` are **top-level required fields** in create/update requests
- `data` contains **only dynamic fields** defined by the entity type
- Example create request:
  ```json
  {
    "entityTypeId": "abc123",
    "name": "My Entity",
    "slug": "my-entity",
    "data": { "description": "...", "customField": "..." }
  }
  ```
- Entity storage: `entity.name` and `entity.slug` are stored at top-level, `entity.data` contains dynamic fields only

### Users
- `POST /api/users/invite` - Invite user
- `GET /api/users` - List users
- `PATCH /api/users/:id/role` - Change role
- `GET /api/users/me/flags` - Get flagged entities

### Manifests
- `GET /manifests/public` - Public manifest
- `GET /manifests/platform` - Platform manifest
- `GET /manifests/bundles/:visibility/:typeId` - Entity bundle

### Platform
- `GET /api/platform/branding` - Get platform branding config (public, uses optionalAuth)
- `PATCH /api/platform/branding` - Update platform branding config (superadmin only)

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
- ✅ TanStack DB integration for true offline (completed - uses LocalStorageCollection for persistence with ETag-based bundle sync)
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
- ✅ Multi-organization user architecture (2026-01-11):
  - **User-org stubs**: New R2 file format `[email-hash]-[user-id]-[org-id]-[role].json` for O(1) membership lookups
  - **Minimal JWT**: JWT now contains only `sub` (userId) and `email` - no org/role info
  - **Auth middleware**: Updated to check superadmin status from env, membership from stubs per-request
  - **/auth/me extended**: Now returns `organizations: [{id, name, slug, role}]` array
  - **Frontend auth store**: Added `organizations`, `currentOrganization`, `switchOrganization()`
  - **Admin Dashboard**: Uses auth store for org data, instant client-side org switching
  - **Organization routes**: Create/delete user-org stubs on membership changes
  - Organization switching is now client-side (no re-authentication needed)
  - Users can seamlessly work across multiple organizations without logging out
- ✅ Deterministic human-readable field IDs in TypeBuilder (2026-01-11):
  - Field IDs are now generated from the field name using snake_case (e.g., "Product Name" → "product_name")
  - Section IDs similarly generated from section name (e.g., "Main Information" → "main_information")
  - No more timestamp-based suffixes like `field_0_1768070647268`
  - If a collision occurs, a numeric suffix is added (e.g., "name_2", "name_3")
  - IDs are limited to 50 characters and only contain lowercase letters, numbers, and underscores
  - This makes entity data more readable and easier to query
- ✅ Manual Field ID editing in TypeBuilder (2026-01-15):
  - Field ID input added to FieldEditorModal - auto-populates from field name (e.g., "Product Description" → "product_description")
  - Users can manually edit the field ID for new fields if they want a different ID
  - Field ID is a required field with red asterisk indicator
  - Real-time uniqueness validation - shows error message if ID already exists in the entity type
  - Save button disabled until field ID is valid (non-empty and unique)
  - Field ID shown in the fields list for each field (displayed as monospace code badge)
  - Existing fields have their IDs locked to prevent data corruption
  - Built-in fields (name, slug) also have locked IDs
- ✅ Built-in field protection in TypeBuilder (2026-01-15):
  - Built-in fields (name, slug) cannot be edited - all inputs are disabled in the field editor modal
  - Edit button is disabled for built-in fields with tooltip "Built-in fields cannot be edited"
  - Built-in fields can still be reordered within their section (reorder buttons enabled)
  - Built-in fields are visually distinguished with primary color styling and "Built-in" badge
  - Save button is disabled when editing built-in fields to prevent accidental changes
  - Built-in fields cannot be removed (delete button hidden)
  - Field editor modal prevents saving changes to built-in fields even if somehow triggered
- ✅ Polished admin EntityView redesign (2026-01-11):
  - EntityView.tsx now displays entities as clean, published content pages
  - Hero header with organization name as label, large title, and status indicator (colored dot)
  - Fields are grouped by sections defined in the entity type (sorted by displayOrder)
  - Technical fields (name, description, slug, ID, version) removed from main display
  - Description shown as primary prose content block below header
  - Each section rendered as a card with proper field display names
  - Minimal admin UI: subtle Edit button, back navigation, footer with last updated date
  - No sidebar with technical metadata - focuses entirely on content
  - Clean, magazine-style layout suitable for public-facing content
- ✅ Admin entity type cards and navigation (2026-01-11):
  - Dashboard shows entity type cards with count and "Add New" button
  - Clicking card navigates to dedicated EntityTypeView route
  - EntityTypeView shows filtered list of entities for that type
  - Clicking entity row navigates to read-only EntityView
  - "Edit" button navigates to EntityEditor
  - Organization clearly displayed in both view and edit modes
- ✅ Organization selection and global entities (2026-01-10):
  - Users can now select which organization to create entities for when they're members of multiple orgs
  - Superadmins can create global/platform-wide entities (organizationId = null)
  - Organization selector always visible when creating new entities
  - Global entities are stored in platform/ or public/ paths (not org-specific)
  - Global entities cannot use 'members' visibility (automatically changed to 'authenticated')
  - Backend validates superadmin permissions for global entity creation
  - Entity types updated to support null organizationId
- ✅ Admin entities list page (2026-01-10):
  - Added `/admin/entities` route with full entity listing page
  - Includes filtering by type, status, and search query
  - Pagination support for large entity lists
  - Breadcrumb navigation linking from EntityEditor
  - Displays entity name, type, status, and last updated date
  - Links to edit individual entities
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
  - Fixed approval queue to show entity names and organization names (NEF-6):
    - Approval queue now displays `entity.name` (top-level property)
    - Fetches and displays organization names alongside entity information
    - Backend API includes `organizationId` in `EntityListItem` response
      - Standardized entity name field convention across the system:
      - All entities have `name` and `slug` as top-level properties (not in `data`)
      - TypeBuilder creates fields with standard IDs: `name` and `slug`
      - EntityEditor handles both standard and auto-generated field IDs
  - Entity slug auto-generation (NEF-7):
    - Slug field is automatically generated from the name field when creating new entities
    - Slug field is editable - users can manually edit the auto-generated slug if needed
    - Slug auto-updates in real-time as the user types in the name field (for new entities only)
    - Once the entity has been saved, the slug will NOT auto-update even if the name changes
    - Once the user manually edits the slug, it won't be overwritten by name changes
    - Slug field displays helper text: "Auto-generated from name (you can edit if needed)"
    - Slug input is filtered to only allow characters: a-z, 0-9, and hyphens (-)
    - Backend auto-generates slug from name if not provided in create request (POST only)
    - Backend does NOT update slug from name changes in update requests (PATCH)
    - Slug generation uses `slugify()` utility: lowercase, hyphens for spaces, removes special chars
    - Both name and slug are required fields for all entity types
  - Fixed platform branding endpoint 401 error (2026-01-11):
    - Platform routes now bypass global auth middleware to allow public access
    - GET /api/platform/branding uses optionalAuth middleware (works with or without token)
    - Global auth middleware now skips /api/platform routes
    - This allows branding to load on public pages before user authentication
  - Fixed EntityView infinite loop bug (2026-01-11):
    - EntityView was in an infinite loop when organizations weren't immediately loaded
    - Root cause: `session.value` was in useEffect dependency array, and the effect updated session
    - Added `orgRefreshAttempted` flag to prevent repeated organization refresh attempts
    - Added `resolvedOrgId` state to cache the resolved organization ID
    - Added `loadEntityDirectly()` function that was previously undefined
    - Added `effectiveOrgId` computed value that was previously undefined (used in navigation links)
    - Changed dependency array to use `organizations.value.length` instead of full object
    - Now fetches organizations only once, then loads entity directly with resolved org ID
  - Fixed superadmin organization access bug (2026-01-11):
    - `/api/user/me`, `/auth/me`, and `/auth/verify` were returning 0 organizations for superadmins
    - Root cause: Organizations were only returned from user-org stubs, but superadmins don't have stubs
    - Fixed by checking `isSuperadmin` flag and listing ALL active organizations for superadmins
    - Superadmins now get `org_admin` role for all organizations in the system
    - Regular users still use user-org stubs for their organization list
  - Added `GET /api/entities/:id` endpoint for global/platform entities (2026-01-11):
    - New endpoint for entities with `organizationId: null` (global entities)
    - Checks both 'authenticated' (platform/) and 'public' paths
    - Returns 404 for org-scoped entities (should use `/api/orgs/:orgId/entities/:id`)
    - EntityView falls back to this endpoint when org-scoped fails with 404
    - Consistent with API route structure: `/api/*` = authenticated platform content

  - Superadmin hard delete (superDelete) action (2026-01-15):
    - **Feature**: Added `superDelete` action for superadmins to permanently remove entities
    - **Endpoint**: `POST /api/super/entities/:id/transition` with `action: 'superDelete'`
    - **Behavior**:
      - Can be called from ANY entity status (bypasses normal state machine validation)
      - Permanently deletes all R2 files: entity stub, all version files, latest pointer
      - Deletes slug index if entity was public
      - Regenerates bundles to remove entity from all bundle files
      - Returns `{ deleted: true, entityId, action: 'superDelete', message: '...' }`
    - **Security**: Only available through `/api/super/*` routes (requires superadmin auth)
    - **Difference from soft delete**: Regular `delete` changes status to 'deleted' (recoverable with `restore`), `superDelete` removes data permanently
    - **Frontend UI**: 
      - **SuperEntityEditor**: "Hard Delete (Permanent)" button in Actions sidebar
        - Available for ALL entity statuses (not just draft)
        - Double confirmation required: first confirm dialog, then must type entity name
        - Styled with red border and skull icon to indicate danger
      - **SuperEntityTypeView** (entity type listing): Bulk hard delete in multi-select toolbar
        - Select multiple entities with checkboxes
        - "Hard Delete" button appears in bulk actions toolbar (alongside "Archive Selected")
        - Confirmation modal requires typing "DELETE" to confirm
        - Permanently deletes all selected entities

  - Multi-select bulk delete in SuperEntityTypeView (2026-01-15):
    - **Feature**: Added multi-select with bulk delete (archive) functionality
    - **Location**: `/super/entity-types/:typeId` page for superadmins
    - **Component updates**:
      - `EntitiesTableCore.tsx`: Added checkbox column, select all, bulk actions toolbar
      - `SuperEntityTypeView.tsx`: Added bulk delete handler calling transition API
    - **Behavior**:
      - Checkbox column appears when `onBulkDelete` prop is provided
      - "Select all" checkbox in header selects/deselects all entities on current page
      - Bulk actions toolbar shows when items are selected (count, clear, delete buttons)
      - Confirmation modal before deletion with entity count
      - Uses `POST /api/super/entities/:id/transition` with action `archive` for each entity
      - Selection is cleared when entities list changes (pagination, filters)
    - **Styling**: Selected rows have light primary background highlight
    - **Error handling**: Uses `Promise.allSettled` to continue even if some fail

  - Entity name display fix (2026-01-15):
    - **Fixed TypeListingPage.tsx**: Interface was missing `name` property - entities were showing IDs
    - **Fixed Alerts.tsx**: Was accessing `entity?.data?.name` instead of `entity?.name`
    - **Root cause**: Entity `name` and `slug` are top-level common properties, not stored in `data`

  - Entity Type hard delete (superadmin only) (2026-01-15):
    - **Feature**: Added hard delete endpoint for permanently removing entity types
    - **Endpoint**: `DELETE /api/entity-types/:id/hard`
    - **Query parameters**:
      - `deleteEntities` (boolean, optional): If true, also deletes all entities of this type
    - **Requirements**: 
      - If `deleteEntities` is false/omitted: Entity type must have NO entities associated with it (prevents orphaned data)
      - If `deleteEntities` is true: All entities of this type will be permanently deleted first, then the type
    - **Behavior**:
      - Validates no entities exist of this type (returns error with count if entities exist and deleteEntities=false)
      - Only counts entities that have actual data (not orphaned stubs)
      - If `deleteEntities=true`: Deletes all entities of this type using same logic as superDelete (all version files, stubs, slug indexes, regenerates bundles)
      - Cleans up any orphaned stubs (stubs without entity data) before deletion
      - Permanently deletes entity type definition file from R2
      - Removes type from all organization permissions (viewable/creatable arrays)
      - Regenerates all manifests (global and org) to reflect the deletion
      - **Manifest regeneration**: Uses `regenerateAllManifests()` which lists entity type files, so deleted types are automatically excluded from all manifests
      - Returns `{ message: '...', typeId, typeName }`
    - **Security**: Only available to superadmins
    - **Difference from soft delete**: Regular `DELETE /api/entity-types/:id` sets `isActive: false` (recoverable), hard delete removes data permanently
    - **Orphaned stub handling**: The count function verifies entities have actual data (latest pointer exists), and hard delete automatically cleans up orphaned stubs
    - **Frontend UI** (TypeBuilder.tsx):
      - "Hard Delete" button in Actions section (only shown when editing existing type)
      - Confirmation modal requires typing exact entity type name to confirm
      - Shows entity count when opening modal
      - **Checkbox option**: "Also delete all X entities of this type" (only shown if type has entities)
      - Shows warnings about what will be deleted
      - Displays entity count in warning list if checkbox is checked
      - Redirects to types list after successful deletion

  - Bulk Content Deletion (superadmin only) (2026-01-15):
    - **Feature**: Added bulk deletion tool to permanently delete all entities and entity types
    - **Location**: Superadmin Dashboard (`/super`)
    - **UI**:
      - "Bulk Content Deletion" card with red border and warning styling
      - "Delete All Content" button opens modal
      - Modal shows list of all entity types with checkboxes
      - Displays entity count for each type
      - Shows total entities and entity types to be deleted for selected types
      - Requires typing "DELETE ALL" to confirm
      - Progress bar and status updates during deletion (includes both entities and types)
    - **Behavior**:
      - Fetches all entities for each selected type using `/api/entities?typeId=...`
      - Uses pagination to get all entities (100 per page)
      - Deletes each entity using `POST /api/super/entities/:id/transition` with `action: 'superDelete'`
      - After all entities are deleted, hard deletes the entity types using `DELETE /api/entity-types/:id/hard`
      - Shows progress: current/total count (entities + types) and current item being processed
      - Handles errors gracefully - continues deleting even if some fail
      - Reports success/failure counts for both entities and types after completion
      - Reloads entity types to update counts after deletion
    - **Security**: Only available to superadmins, requires explicit confirmation
    - **Warning**: This is a destructive operation that permanently deletes:
      - All entity data, versions, and files
      - The selected entity types themselves
      - All associated permissions and manifest references
    - **All entity lists now correctly display names** from top-level property

  - Debug Panel for client state inspection (2026-01-15):
    - **Hidden debug UI**: Toggle with `Ctrl+Shift+D` (or `Cmd+Shift+D` on Mac)
    - **Location**: `apps/web/src/components/DebugPanel.tsx`, integrated into Layout
    - **Shows**:
      - Auth state (user ID, email, current org, role, session expiry)
      - Platform manifest status and entity types
      - Platform bundles (loaded, version, entity count, generation time)
      - Org manifest and org bundles (for authenticated users)
      - Branding/app config (site name, colors, URLs)
      - LocalStorage cache status (what's cached)
      - Environment info (URL, online status)
    - **Actions**:
      - Force Sync: Triggers immediate sync with server
      - Clear Cache: Clears all cached data (manifest, bundles, localStorage)
      - Reload Branding: Reloads branding config from server
    - **Status indicators**: Green (loaded), amber (partial/warning), red (error)
    - **Helpful for debugging**: Why bundles aren't loading, auth state issues, cache problems

  - Entity duplicate detection (2026-01-11):
    - Added duplicate name/slug detection in entity create/edit forms
    - Scope: Same entity type + same organization (two different types CAN share slug)
    - **Org bundles now include ALL entity statuses** (draft, pending, published, archived)
      - Previously only included published entities
      - Change in `apps/worker/src/routes/manifests.ts` line 381-383
      - Allows admin users to check duplicates against all entities in their org
    - **Backend slug validation**: POST `/api/orgs/:orgId/entities` now checks slug uniqueness
      - Scans actual entities in R2 (not bundle - bundles may be stale)
      - Checks all entities in org with same entity type
      - Returns 409 CONFLICT if slug already exists: `Slug 'xyz' already exists for this entity type in this organization`
      - Change in `apps/worker/src/routes/orgs/entities.ts`
    - **Frontend duplicate checking**: EntityEditor and SuperEntityEditor now show warnings
      - Fetches org bundle via `GET /manifests/bundles/org/:orgId/:typeId`
      - Uses `checkDuplicatesInBundle()` utility from `apps/web/src/lib/utils.ts`
      - Name duplicate: Yellow warning with link to existing entity (non-blocking)
      - Slug duplicate: Red error with link, blocks save button (blocking)
    - **Note**: Global entities (organizationId: null) skip duplicate checking since they don't belong to an org

  - SuperEntityEditor API endpoint fix (2026-01-15):
    - **Bug**: SuperEntityEditor was calling `/api/entities/:id` which only works for global entities
    - **Fix**: Changed to use `/api/super/entities/:id` for GET, PATCH, and transition operations
    - **Added endpoints**:
      - `PATCH /api/super/entities/:id` - Update any entity (global or org-scoped)
      - `POST /api/super/entities/:id/transition` - Status transitions (delete, archive, approve, etc.)
    - **Location**: `apps/worker/src/routes/super/entities.ts`
    - **Note**: `/api/entities/:id` returns 404 for org-scoped entities (by design)
    - **Superadmin endpoints**: Can access/modify any entity (global or org-scoped)
    - **Delete functionality**: Uses soft delete via 'delete' transition (status = 'deleted')

  - Membership keys bundle system (2026-01-15) - **COMPLETED**:
    - **Config-driven membership keys**: Keys defined in `app.json` under `membershipKeys`
    - **Organization tiers**: Each org has `membershipTier` that grants specific keys
    - **Entity type visibility**: `visibleTo` array specifies which keys can see the type
    - **Field-level visibility**: `fieldVisibility` allows per-field access control
    - **Bundle structure**: Global bundles per key (field-projected), org bundles (all fields)
    - **Field projection**: Entities returned with only fields visible to user's membership keys
    - **Security**: `/files/*` endpoint restricted to `uploads/` prefix only
    - **Config validation**: `visibleTo`, `fieldVisibility`, and `membershipTier` validated against app.json
    - **Middleware**: `requireMembershipKey()` available for route-level access control
    - **Frontend sync**: Updated to fetch org-specific bundles for authenticated org members/admins
    - **Removed legacy**: `apps/worker/src/routes/manifests.ts` replaced by new route files
    - **Frontend cleanup**: Updated obsolete API references:
      - `EntityEditor.tsx`, `SuperEntityEditor.tsx`: Changed `/manifests/bundles/org/...` to `/api/orgs/:orgId/bundles/:typeId`
      - `SuperEntityTypeView.tsx`: Changed `defaultVisibility` to `visibleTo`
      - `csv.test.ts`: Updated mock data to use `visibleTo` field

  - Bundle auto-regeneration system (2026-01-11):
    - **Problem**: Bundles and manifests were only regenerated on-demand (lazy) or during publish/unpublish
    - **Solution**: Centralized bundle-invalidation.ts service for synchronous regeneration
    - **Location**: `apps/worker/src/lib/bundle-invalidation.ts`
    - **Key functions**:
      - `invalidateBundlesForFile(bucket, filePath, ability, entityMetadata?)` - Main entry point: analyzes file path and regenerates affected bundles/manifests
      - `regenerateEntityBundles(bucket, typeId, orgId, config, ability)` - Regenerate bundles when entity changes (called automatically by `invalidateBundlesForFile()`)
      - `regenerateManifestsForType(bucket, typeId, config)` - Regenerate manifests when entity type changes
      - `regenerateOrgManifest(bucket, orgId)` - Regenerate org manifest
      - **Automatic Bundle Invalidation**: `writeJSON()` automatically calls `invalidateBundlesForFile()` after successful entity writes
    - **Bundle creation triggers** (2026-01-XX):
      - Bundles are automatically created when they logically should exist, even if empty:
        - When entity types are created (if they have `visibleTo` configured)
        - When organizations are created (for all entity types)
        - When entity type `visibleTo` is updated
      - This ensures bundles exist immediately, not just when entities are created
      - `regenerateOrgBundles(bucket, orgId, typeIds, config)` - Regenerate all bundles for an org
    - **Trigger events**:
      - Entity create/update/delete (entities.ts, orgs/entities.ts)
      - Entity status transitions (publish/unpublish)
      - Entity type create/update/archive (entity-types.ts)
      - Organization permission changes (organizations.ts)
    - **Bundle types and visibility**:
      - `public` bundles: Only published entities with public visibility
      - `authenticated` bundles: Only published entities with public or authenticated visibility
      - `members` (org) bundles: ALL entities of any status for admin visibility
    - **Changes by file**:
      - `entities.ts`: POST /, PATCH /:id, POST /:id/transition, POST /bulk-import
      - `orgs/entities.ts`: POST /entities, PATCH /entities/:id, POST /entities/:id/transition (new routes)
      - `entity-types.ts`: POST /, PATCH /:id, DELETE /:id, DELETE /:id/hard (hard delete)
      - `organizations.ts`: PATCH /:id/permissions
    - **Synchronous regeneration**: All regeneration is synchronous for consistency

## Notes

- Entity IDs are 7-character NanoID (lowercase alphanumeric)
- All timestamps use ISO 8601 format
- Entity updates use atomic field merging (only changed fields sent)
- Explicit save model - no auto-save
- Bundles are pre-aggregated for fast client sync
- Org bundles include ALL entity statuses for admin visibility
- Bundle regeneration is synchronous and centralized in `bundle-invalidation.ts`

### Bundle Data Structure

Bundles use `typeId` (NOT `entityTypeId`) to identify the entity type:

```typescript
interface EntityBundle {
  typeId: string;        // Entity type ID (NOT entityTypeId)
  typeName: string;
  generatedAt: string;
  entityCount: number;
  entities: BundleEntity[];
}

interface BundleEntity {
  id: string;
  status: EntityStatus;
  name: string;
  slug: string;
  data: Record<string, unknown>;  // Does NOT include entityTypeId
  updatedAt: string;
  // NOTE: entityTypeId is NOT included - type is identified by parent bundle's typeId
}
```

**Important**: 
- `EntityBundle` uses `typeId` at the bundle level (not `entityTypeId`)
- `BundleEntity` does NOT include `entityTypeId` - the type is identified by the parent bundle's `typeId` field
- This keeps bundle entities compact and avoids redundancy
- **Bundles do NOT have versions** - change detection uses HTTP ETags instead (see Client Data Sync section below)

### Client Data Sync (ETag-Based)

Client data synchronization uses HTTP ETags for efficient bundle change detection and TanStack DB for offline-first local storage:

**ETag-Based Bundle Sync:**
- Bundles do NOT have version numbers - change detection uses HTTP ETags
- Server returns `ETag` header in bundle responses (generated from R2 object MD5 hash)
- Client sends `If-None-Match` header with stored ETag on bundle requests
- Server returns `304 Not Modified` if ETag matches (no body transfer)
- Client stores ETags in TanStack DB for conditional requests
- Entities retain version numbers for historical tracking

**TanStack DB + Query Integration:**
- **TanStack DB**: Client-side database for offline-first local persistence
  - Uses `LocalStorageCollection` for persistence (via `localStorageCollectionOptions`)
  - Collections: `manifests`, `entityTypes`, `bundles`, `entities`
  - Storage keys: `1cc-portal-manifests`, `1cc-portal-entity-types`, `1cc-portal-bundles`, `1cc-portal-entities`
  - Bundle rows store ETags: `{ id, manifestId, typeId, etag, ... }`
  - Data persists across page reloads and syncs across browser tabs automatically
  - Location: `apps/web/src/stores/db.ts`
  - Sync functions: `syncManifest()`, `syncBundle()`, `getBundleEtag()`, `getManifest()`, `getBundle()`
- **TanStack Query**: Server state management with reactive queries (optional, currently using custom sync)
  - Uses `@preact-signals/query` for Preact compatibility
  - Automatic refetch on window focus/reconnect
  - Stale-while-revalidate caching strategy
  - `placeholderData` from DB for instant offline access
- **Query Sync Store** (`apps/web/src/stores/query-sync.ts`): 
  - ETag-based conditional requests via `useQuery$` hooks
  - Automatic DB sync on successful API responses
  - Manual refresh via `queryClient.invalidateQueries()`
- **Sync Store** (`apps/web/src/stores/sync.tsx`):
  - Updated to sync bundles to TanStack DB when loaded
  - Uses `getBundleEtag()` from DB for conditional requests
  - Calls `syncManifest()` and `syncBundle()` after fetching data

**Initial Deeplink Load:**
- TanStack Query and TanStack DB are NOT available on initial deeplink render
- Initial load uses standard fetch/API calls without Query/DB dependencies
- Query/DB are loaded client-side after initial render for SEO/fast initial load

**Sync Store** (`apps/web/src/stores/sync.tsx`):
- Uses localStorage and Preact signals for backward compatibility
- Updated to use ETag-based API requests (removed version checks)
- Automatically syncs all loaded bundles to TanStack DB via `syncBundle()`
- Automatically syncs manifests to TanStack DB via `syncManifest()`
- Uses `getBundleEtag()` from DB for conditional requests instead of localStorage
- **Data access functions deprecated**: `getEntityType()`, `getBundle()`, `getEntity()`, `getEntityBySlug()`, `entityTypes`, `bundles` are deprecated
- **Migration complete**: All UI components now use DB hooks from `hooks/useDB.ts` instead of sync store data access

**DB Hooks** (`apps/web/src/hooks/useDB.ts`):
- `useEntityType(idOrSlug)` - Get entity type by ID or slug
- `useEntityTypes(manifestId?)` - Get all entity types for a manifest (uses `useManifestId()` if not provided)
- `useBundle(manifestId, typeId)` - Get bundle by manifest ID and type ID
- `useEntity(entityId)` - Get entity by ID
- `useEntityBySlug(typeId, slug)` - Get entity by type ID and slug
- `useManifestId()` - Helper hook to determine correct manifest ID based on auth state
- All hooks return `{ data, loading, error }` for reactive state management
- All hooks query TanStack DB (LocalStorageCollection) for offline-first access

### Entity Data Structure

Entity `name` and `slug` are **common properties stored at the top level** of the Entity object (not in `.data`):

```typescript
interface Entity {
  id: string;
  name: string;           // Common property (top-level) - REQUIRED
  slug: string;           // Common property (top-level) - REQUIRED
  data: Record<string, unknown>;  // Dynamic fields only (NOT name/slug)
  // ... other fields
}
```

**Important**: Name and Slug are always top-level Entity properties (`entity.name`, `entity.slug`), never dynamic fields. The CSV export/import:
- Skips any fields named "Name" or "Slug" from entity type fields (regardless of field ID)
- Reads name/slug from `entity.name`/`entity.slug`, with fallback to `entity.data[fieldId]` for legacy entities
- Entity types should NOT include Name/Slug as fields - they are implicit system fields

Related code paths:
- CSV export (`apps/web/src/lib/csv.ts:generateCSV`) - skips fields by `field.name === 'Name' || field.name === 'Slug'`
- CSV import (`apps/web/src/lib/csv.ts:convertToImportData`) - same skip logic
- Backend validation (`apps/worker/src/lib/entity-validation.ts:validateEntityData`) - skips Name/Slug fields
- API entity listing (`apps/worker/src/routes/api/entities.ts`)
- Entity create/update routes enforce storing `name` and `slug` at top-level

**Frontend display**: All entity lists and cards must access `entity.name` directly, NOT `entity.data.name`. Key files that display entity names:
- `EntityCard.tsx`: Uses `entity.name || \`Entity ${entity.id}\``
- `EntitiesTableCore.tsx`: Uses `entity.name || entity.id`
- `EntityDetail.tsx`, `EntityView.tsx`, `EntityViewCore.tsx`: Uses `entity.name || 'Untitled'`
- `TypeListingPage.tsx`: Uses `entity.name || \`Entity ${entity.id}\``
- `Alerts.tsx`: Uses `entity?.name || \`Entity ${flag.entityId}\``
- `ApprovalQueue.tsx`: Uses `entity.name || \`Entity ${entity.id}\``