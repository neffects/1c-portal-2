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
config/app.json           # App configuration
public/                   # Public content
platform/                 # Platform content
private/orgs/{orgId}/     # Organization-specific content
private/user-stubs/       # User-org membership stubs (for fast lookup)
stubs/{entityId}.json     # Entity ownership lookup
secret/ROOT.json          # Root config
```

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
- `GET /api/manifests/site` - Get platform manifest
- `GET /api/bundles/:typeId` - Get platform entity bundle
- `GET /api/entities` - List entities (platform content)
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
- `GET /api/orgs/:orgId/users` - List users in org
- `GET /api/orgs/:orgId/manifests/site` - Get org manifest
- `GET /api/orgs/:orgId/bundles/:typeId` - Get org bundle

### Superadmin Routes
- `POST /api/super/organizations` - Create organization (alternative endpoint)
- `GET /api/super/organizations` - List all organizations (alternative endpoint)
- `POST /api/super/entity-types` - Create entity type
- `PATCH /api/super/platform/branding` - Update platform branding

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
    - Approval queue now displays `entity.data.name` instead of entity IDs
    - Fetches and displays organization names alongside entity information
    - Backend API includes `organizationId` in `EntityListItem` response
      - Standardized entity name field convention across the system:
      - All entity types now use `data.name` consistently (not `entity_name`, `title`, etc.)
      - TypeBuilder creates fields with standard IDs: `name` and `slug`
      - EntityEditor strictly checks `fieldId === 'name'` for auto-slug generation
      - Enforces convention: all entities must have `data.name` field
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

  - Bundle auto-regeneration system (2026-01-11):
    - **Problem**: Bundles and manifests were only regenerated on-demand (lazy) or during publish/unpublish
    - **Solution**: Centralized bundle-invalidation.ts service for synchronous regeneration
    - **Location**: `apps/worker/src/lib/bundle-invalidation.ts`
    - **Key functions**:
      - `regenerateEntityBundles(bucket, typeId, orgId, visibility)` - Regenerate bundles when entity changes
      - `regenerateManifestsForType(bucket, typeId)` - Regenerate manifests when entity type changes
      - `regenerateOrgManifest(bucket, orgId)` - Regenerate org manifest
      - `regenerateOrgBundles(bucket, orgId, typeIds)` - Regenerate all bundles for an org
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
      - `entity-types.ts`: POST /, PATCH /:id, DELETE /:id
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