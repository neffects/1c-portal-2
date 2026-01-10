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

### Deployment

```bash
# Deploy worker
npm run deploy:worker

# Build frontend
npm run build
```

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
- 🔲 Production deployment

### Recently Completed
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

## Notes

- Entity IDs are 7-character NanoID (lowercase alphanumeric)
- All timestamps use ISO 8601 format
- Entity updates use atomic field merging (only changed fields sent)
- Explicit save model - no auto-save
- Bundles are pre-aggregated for fast client sync
