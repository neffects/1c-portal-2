# 1C Portal API Documentation

## Overview

The 1C Portal API is a RESTful API built on Cloudflare Workers using the Hono framework. Routes are organized by access level and map directly to R2 storage paths for clarity and maintainability.

### Base URL

- **Development**: `http://localhost:8787`
- **Staging**: `https://1cc-portal-api-staging.your-domain.workers.dev`
- **Production**: `https://api.1cc-portal.com`

### Route Structure

| Route Prefix | Auth Level | R2 Path | Purpose |
|-------------|------------|---------|---------|
| `/public/*` | None | `public/` | SEO-indexable public content |
| `/api/*` | JWT required | `platform/` | Authenticated platform content |
| `/api/user/*` | JWT required | `private/users/:userId/` | User-specific data |
| `/api/orgs/:orgId/*` | JWT + Org membership | `private/orgs/:orgId/` | Org-scoped content |
| `/api/super/*` | JWT + Superadmin | `private/`, `config/`, `secret/` | Platform administration |
| `/files/*` | JWT for upload/delete, public for GET | `uploads/` | File upload and serving |

### Authentication

Most routes require a JWT token in the `Authorization` header:

```
Authorization: Bearer <jwt_token>
```

JWT tokens are obtained through the magic link authentication flow (see Authentication section below).

### Response Format

All API responses follow this structure:

```typescript
{
  success: boolean;
  data?: T;  // Present when success is true
  error?: {  // Present when success is false
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  meta?: {   // Optional pagination/metadata
    page?: number;
    pageSize?: number;
    total?: number;
    hasMore?: boolean;
  };
}
```

### Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `UNAUTHORIZED` | 401 | Missing or invalid authentication token |
| `FORBIDDEN` | 403 | Insufficient permissions for this action |
| `NOT_FOUND` | 404 | Resource doesn't exist |
| `VALIDATION_ERROR` | 400 | Invalid input data |
| `CONFLICT` | 409 | Resource already exists (e.g., duplicate slug) |
| `NETWORK_ERROR` | 500 | Network or server error |

---

## Authentication Routes

### Request Magic Link

**POST** `/auth/magic-link`

Request a magic link for passwordless authentication.

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "If your email is registered, you will receive a magic link shortly."
  }
}
```

### Verify Magic Link

**GET** `/auth/verify?token=<magic_link_token>`

Verify a magic link token and redirect to frontend with JWT. Used in browser flow.

**Query Parameters:**
- `token` (required) - Magic link token from email

**Response:** Redirects to frontend callback URL with JWT token

### Refresh Token

**POST** `/auth/refresh`

Refresh an expiring JWT token.

**Headers:**
```
Authorization: Bearer <current_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "token": "new_jwt_token",
    "expiresAt": "2026-01-18T12:00:00Z"
  }
}
```

### Logout

**POST** `/auth/logout`

Logout (client-side token removal).

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Logged out successfully"
  }
}
```

---

## Public Routes

No authentication required. These routes serve SEO-indexable public content.

### Get Branding

**GET** `/public/branding`

Get platform branding configuration.

**Response:**
```json
{
  "success": true,
  "data": {
    "rootOrgId": "root001",
    "siteName": "OneConsortium",
    "defaultTheme": "light",
    "logoUrl": "/logo.svg",
    "logoDarkUrl": "/logo-dark.svg",
    "faviconUrl": "/favicon.ico",
    "primaryColor": "#0066cc",
    "accentColor": "#00cc66"
  }
}
```

### Get Public Manifest

**GET** `/public/manifests/site`

Get public site manifest listing all available entity types.

**Response:**
```json
{
  "success": true,
  "data": {
    "generatedAt": "2026-01-11T12:00:00Z",
    "version": 1234567890,
    "entityTypes": [
      {
        "id": "type123",
        "name": "Product",
        "pluralName": "Products",
        "slug": "products",
        "description": "Product catalog",
        "entityCount": 42,
        "bundleVersion": 1234567891,
        "lastUpdated": "2026-01-11T11:00:00Z"
      }
    ]
  }
}
```

### Get Public Bundle

**GET** `/public/bundles/:typeId`

Get public entity bundle for a specific type.

**Path Parameters:**
- `typeId` (required) - Entity type ID

**Response:**
```json
{
  "success": true,
  "data": {
    "typeId": "type123",
    "typeName": "Products",
    "generatedAt": "2026-01-11T12:00:00Z",
    "version": 1234567891,
    "entityCount": 42,
    "entities": [
      {
        "id": "ent456",
        "version": 1,
        "status": "published",
        "slug": "dog-toy",
        "data": {
          "name": "Dog Toy",
          "description": "A fun toy for dogs"
        },
        "updatedAt": "2026-01-10T10:00:00Z"
      }
    ]
  }
}
```

### Get Public Entity

**GET** `/public/entities/:id`

Get a public entity by ID.

**Path Parameters:**
- `id` (required) - Entity ID

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "ent456",
    "entityTypeId": "type123",
    "organizationId": "org789",
    "version": 1,
    "status": "published",
    "visibility": "public",
    "slug": "dog-toy",
    "data": {
      "name": "Dog Toy",
      "description": "A fun toy for dogs"
    },
    "createdAt": "2026-01-10T10:00:00Z",
    "updatedAt": "2026-01-10T10:00:00Z",
    "createdBy": "user123",
    "updatedBy": "user123"
  }
}
```

### Deep Link Routes

SEO-friendly slug-based entity access.

#### Get Organization Landing Page

**GET** `/:orgSlug`

Get organization landing page with available entity types.

**Path Parameters:**
- `orgSlug` (required) - Organization slug

**Response:**
```json
{
  "success": true,
  "data": {
    "organization": {
      "id": "org789",
      "name": "Acme Corp",
      "slug": "acme",
      "description": "Leading manufacturer"
    },
    "entityTypes": [
      {
        "id": "type123",
        "name": "Product",
        "slug": "products"
      }
    ]
  }
}
```

#### List Entities by Type

**GET** `/:orgSlug/:typeSlug`

List entities of a specific type in an organization.

**Path Parameters:**
- `orgSlug` (required) - Organization slug
- `typeSlug` (required) - Entity type slug

**Response:**
```json
{
  "success": true,
  "data": {
    "organization": {
      "id": "org789",
      "name": "Acme Corp",
      "slug": "acme"
    },
    "entityType": {
      "id": "type123",
      "name": "Product",
      "pluralName": "Products",
      "slug": "products"
    },
    "entities": [
      {
        "id": "ent456",
        "slug": "dog-toy",
        "data": {
          "name": "Dog Toy",
          "description": "A fun toy for dogs"
        }
      }
    ]
  }
}
```

#### Get Entity by Slug Chain

**GET** `/:orgSlug/:typeSlug/:entitySlug`

Get a specific entity using slug chain (e.g., `/acme/products/dog-toy`).

**Path Parameters:**
- `orgSlug` (required) - Organization slug
- `typeSlug` (required) - Entity type slug
- `entitySlug` (required) - Entity slug

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "ent456",
    "entityTypeId": "type123",
    "organizationId": "org789",
    "version": 1,
    "status": "published",
    "visibility": "public",
    "slug": "dog-toy",
    "data": {
      "name": "Dog Toy",
      "description": "A fun toy for dogs"
    },
    "createdAt": "2026-01-10T10:00:00Z",
    "updatedAt": "2026-01-10T10:00:00Z"
  }
}
```

---

## Authenticated Routes

Require JWT authentication. These routes serve platform-wide authenticated content.

### Get Platform Manifest

**GET** `/api/manifests/site`

Get platform manifest for authenticated users (includes authenticated visibility content).

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response:** Same format as public manifest, but includes authenticated visibility entity types

### Get Platform Bundle

**GET** `/api/bundles/:typeId`

Get platform entity bundle (includes authenticated visibility entities).

**Path Parameters:**
- `typeId` (required) - Entity type ID

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response:** Same format as public bundle

### Get Global Entity

**GET** `/api/entities/:id`

Get a global/platform entity by ID. This endpoint is for entities with `organizationId: null` (global entities stored in `platform/` or `public/` paths).

**Note:** For organization-scoped entities, use `/api/orgs/:orgId/entities/:id` instead.

**Path Parameters:**
- `id` (required) - Entity ID

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "ent456",
    "entityTypeId": "type123",
    "organizationId": null,
    "version": 1,
    "status": "published",
    "visibility": "authenticated",
    "slug": "global-announcement",
    "data": {
      "name": "Global Announcement",
      "description": "Platform-wide announcement"
    },
    "createdAt": "2026-01-10T10:00:00Z",
    "updatedAt": "2026-01-10T10:00:00Z",
    "createdBy": "user123",
    "updatedBy": "user123"
  }
}
```

### List Entities

**GET** `/api/entities`

List entities accessible to authenticated users.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Query Parameters:**
- `typeId` (optional) - Filter by entity type ID
- `organizationId` (optional) - Filter by organization ID (null for global entities)
- `status` (optional) - Filter by status: `draft`, `pending`, `published`, `archived`
- `visibility` (optional) - Filter by visibility: `public`, `authenticated`, `members`
- `search` (optional) - Search in name and description
- `page` (optional, default: 1) - Page number
- `pageSize` (optional, default: 20) - Items per page

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "ent456",
        "entityTypeId": "type123",
        "organizationId": "org789",
        "slug": "dog-toy",
        "status": "published",
        "visibility": "authenticated",
        "data": {
          "name": "Dog Toy",
          "description": "A fun toy for dogs"
        },
        "version": 1,
        "updatedAt": "2026-01-10T10:00:00Z"
      }
    ],
    "total": 42,
    "page": 1,
    "pageSize": 20,
    "hasMore": true
  }
}
```

### Get Entity by ID

**GET** `/api/entities/:id`

Get an entity by ID. Returns the latest version unless a specific version is requested.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Path Parameters:**
- `id` (required) - Entity ID

**Query Parameters:**
- `version` (optional) - Specific version number to retrieve

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "ent456",
    "entityTypeId": "type123",
    "organizationId": "org789",
    "version": 1,
    "status": "published",
    "visibility": "authenticated",
    "slug": "dog-toy",
    "data": {
      "name": "Dog Toy",
      "description": "A fun toy for dogs"
    },
    "createdAt": "2026-01-10T10:00:00Z",
    "updatedAt": "2026-01-10T10:00:00Z",
    "createdBy": "user123",
    "updatedBy": "user123"
  }
}
```

**Access Control:**
- Superadmins can access any entity
- Org admins can access entities from their organization
- Draft entities are only visible to organization admins
- Members-only entities are only visible to members of that organization

**Error Responses:**
- `401` - Unauthorized (missing or invalid token)
- `403` - Forbidden (insufficient permissions)
- `404` - Entity not found

### Create Entity

**POST** `/api/entities`

Create a new entity in the user's organization (or global if superadmin).

**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "entityTypeId": "type123",
  "data": {
    "name": "New Product",
    "description": "Product description",
    "slug": "new-product"
  },
  "visibility": "public",
  "organizationId": null
}
```

**Notes:**
- `organizationId` is optional. If not provided, uses user's organization
- Superadmins can set `organizationId: null` to create global entities
- Regular users cannot create global entities

**Response:** Same format as Get Entity by ID

### Update Entity

**PATCH** `/api/entities/:id`

Update an entity with atomic field merge. Only draft entities can be edited.

**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Path Parameters:**
- `id` (required) - Entity ID

**Request Body:**
```json
{
  "data": {
    "name": "Updated Product Name",
    "description": "Updated description"
  }
}
```

**Response:** Updated entity object

**Error Responses:**
- `400` - Entity is not in draft status (only drafts can be edited)
- `403` - Forbidden (not authorized to edit this entity)
- `404` - Entity not found

### Submit Entity for Approval

**POST** `/api/entities/:id/transition`

Transition entity status (e.g., draft → pending → published).

**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Path Parameters:**
- `id` (required) - Entity ID

**Request Body:**
```json
{
  "action": "submitForApproval"
}
```

**Actions:**
- `submitForApproval` - Move from draft to pending
- `approve` - Move from pending to published (superadmin only)
- `reject` - Move from pending back to draft (superadmin only)
- `archive` - Archive published entity
- `publish` - Publish draft (superadmin only)

**Response:** Updated entity object

### Delete Entity

**DELETE** `/api/entities/:id`

Soft delete an entity (sets status to 'deleted').

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Path Parameters:**
- `id` (required) - Entity ID

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Entity deleted"
  }
}
```

### List Entity Types

**GET** `/api/entity-types`

List available entity types.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Query Parameters:**
- `permission` (optional) - Filter by permission: `viewable` or `creatable` (requires organization context)

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "type123",
        "name": "Product",
        "pluralName": "Products",
        "slug": "products",
        "description": "Product catalog",
        "defaultVisibility": "public",
        "fieldCount": 8,
        "entityCount": 42,
        "isActive": true
      }
    ],
    "total": 5
  }
}
```

---

## User Routes

User-specific routes requiring authentication.

### Get Current User

**GET** `/api/user/me`

Get current user information including all organizations.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "user123",
    "email": "user@example.com",
    "isSuperadmin": false,
    "organizations": [
      {
        "id": "org789",
        "name": "Acme Corp",
        "slug": "acme",
        "role": "org_admin"
      }
    ],
    "tokenExpiresAt": "2026-01-18T12:00:00Z",
    "tokenExpiringSoon": false
  }
}
```

### Get User Preferences

**GET** `/api/user/preferences`

Get current user's preferences.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "userId": "user123",
    "notifications": {
      "emailAlerts": true,
      "alertFrequency": "daily",
      "digestTime": "09:00"
    },
    "ui": {
      "theme": "system",
      "language": "en"
    },
    "updatedAt": "2026-01-11T10:00:00Z"
  }
}
```

### Update User Preferences

**PATCH** `/api/user/preferences`

Update current user's preferences.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "notifications": {
    "emailAlerts": false,
    "alertFrequency": "weekly"
  },
  "ui": {
    "theme": "dark"
  }
}
```

**Response:** Updated preferences object

### Get Flagged Entities

**GET** `/api/user/flags`

Get entities the current user has flagged for alerts.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "userId": "user123",
        "entityId": "ent456",
        "reason": "Watching for updates",
        "flaggedAt": "2026-01-11T10:00:00Z"
      }
    ],
    "total": 3
  }
}
```

### Flag Entity

**POST** `/api/user/flags`

Flag an entity to receive alerts when it's updated.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "entityId": "ent456",
  "reason": "Watching for updates"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "userId": "user123",
    "entityId": "ent456",
    "reason": "Watching for updates",
    "flaggedAt": "2026-01-11T10:00:00Z"
  }
}
```

### Unflag Entity

**DELETE** `/api/user/flags/:entityId`

Remove flag from an entity.

**Path Parameters:**
- `entityId` (required) - Entity ID

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Flag removed"
  }
}
```

---

## Organization Routes

Organization-scoped routes requiring authentication and organization membership.

**Note:** To create **global entities** (platform-wide, not tied to any organization), superadmins should use `/api/super/entities` with `organizationId: null` instead.

### Create Entity

**POST** `/api/orgs/:orgId/entities`

Create a new entity in an organization.

**Path Parameters:**
- `orgId` (required) - Organization ID

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "entityTypeId": "type123",
  "data": {
    "name": "New Product",
    "description": "Product description",
    "slug": "new-product"
  },
  "visibility": "public"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "ent789",
    "entityTypeId": "type123",
    "organizationId": "org789",
    "version": 1,
    "status": "draft",
    "visibility": "public",
    "slug": "new-product",
    "data": {
      "name": "New Product",
      "description": "Product description"
    },
    "createdAt": "2026-01-11T12:00:00Z",
    "updatedAt": "2026-01-11T12:00:00Z",
    "createdBy": "user123",
    "updatedBy": "user123"
  }
}
```

### List Organization Entities

**GET** `/api/orgs/:orgId/entities`

List entities in an organization.

**Path Parameters:**
- `orgId` (required) - Organization ID

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Query Parameters:** Same as `/api/entities`

**Response:** Same format as `/api/entities`

### Get Organization Manifest

**GET** `/api/orgs/:orgId/manifests/site`

Get organization-specific manifest (includes members-only content).

**Path Parameters:**
- `orgId` (required) - Organization ID

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response:** Same format as public manifest

### Get Organization Bundle

**GET** `/api/orgs/:orgId/bundles/:typeId`

Get organization-specific entity bundle.

**Path Parameters:**
- `orgId` (required) - Organization ID
- `typeId` (required) - Entity type ID

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response:** Same format as public bundle

### List Organization Users

**GET** `/api/orgs/:orgId/users`

List users in an organization.

**Path Parameters:**
- `orgId` (required) - Organization ID

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "user123",
        "email": "user@example.com",
        "role": "org_admin",
        "organizationId": "org789"
      }
    ],
    "total": 5
  }
}
```

---

## Superadmin Routes

Platform administration routes requiring superadmin role.

### Create Organization

**POST** `/api/super/organizations`

Create a new organization.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "name": "New Organization",
  "slug": "new-org",
  "description": "Organization description",
  "domainWhitelist": ["example.com"],
  "allowSelfSignup": false
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "org999",
    "name": "New Organization",
    "slug": "new-org",
    "profile": {
      "description": "Organization description"
    },
    "settings": {
      "domainWhitelist": ["example.com"],
      "allowSelfSignup": false
    },
    "createdAt": "2026-01-11T12:00:00Z",
    "updatedAt": "2026-01-11T12:00:00Z",
    "isActive": true
  }
}
```

### List Organizations

**GET** `/api/super/organizations`

List all organizations.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "org789",
        "name": "Acme Corp",
        "slug": "acme",
        "profile": {
          "description": "Leading manufacturer"
        },
        "settings": {
          "domainWhitelist": [],
          "allowSelfSignup": false
        },
        "createdAt": "2026-01-10T10:00:00Z",
        "updatedAt": "2026-01-10T10:00:00Z",
        "isActive": true
      }
    ],
    "total": 10
  }
}
```

### Create Entity Type

**POST** `/api/super/entity-types`

Create a new entity type (schema).

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "name": "Product",
  "pluralName": "Products",
  "slug": "products",
  "description": "Product catalog",
  "defaultVisibility": "public",
  "fields": [
    {
      "name": "Name",
      "type": "string",
      "required": true,
      "displayOrder": 0,
      "sectionId": "main",
      "showInTable": true
    }
  ],
  "sections": [
    {
      "name": "Main Information",
      "displayOrder": 0
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "type123",
    "name": "Product",
    "pluralName": "Products",
    "slug": "products",
    "description": "Product catalog",
    "defaultVisibility": "public",
    "fields": [...],
    "sections": [...],
    "createdAt": "2026-01-11T12:00:00Z",
    "updatedAt": "2026-01-11T12:00:00Z",
    "createdBy": "user123",
    "updatedBy": "user123",
    "isActive": true
  }
}
```

### Update Platform Branding

**PATCH** `/api/super/platform/branding`

Update platform branding configuration.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "siteName": "New Site Name",
  "logoUrl": "/new-logo.svg",
  "primaryColor": "#0066cc"
}
```

**Response:** Updated branding config

### Get Approval Queue

**GET** `/api/super/approval-queue`

Get entities pending approval across all organizations.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "ent456",
        "entityTypeId": "type123",
        "organizationId": "org789",
        "status": "pending",
        "data": {
          "name": "New Product"
        },
        "createdAt": "2026-01-11T10:00:00Z"
      }
    ],
    "total": 5
  }
}
```

### Create Entity (Global or Org)

**POST** `/api/super/entities`

Create an entity. Superadmins can create **global entities** (platform-wide, not tied to any organization) or entities in any organization.

This is the primary endpoint for superadmins to create global entities by setting `organizationId: null`.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "entityTypeId": "type123",
  "data": {
    "name": "Global Announcement",
    "description": "Platform-wide announcement",
    "slug": "global-announcement"
  },
  "visibility": "public",
  "organizationId": null
}
```

**Notes:**
- Set `organizationId: null` to create a **global entity** (platform-wide, not tied to any organization)
- Set `organizationId: "org789"` to create an entity in a specific organization
- Global entities cannot have `visibility: "members"` - will be automatically changed to `"authenticated"`
- Global entities are stored in visibility-based paths (`public/` or `platform/`) instead of org-specific paths

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "ent999",
    "entityTypeId": "type123",
    "organizationId": null,
    "version": 1,
    "status": "draft",
    "visibility": "public",
    "slug": "global-announcement",
    "data": {
      "name": "Global Announcement",
      "description": "Platform-wide announcement"
    },
    "createdAt": "2026-01-11T12:00:00Z",
    "updatedAt": "2026-01-11T12:00:00Z",
    "createdBy": "user123",
    "updatedBy": "user123"
  }
}
```

### Get Entity (Any)

**GET** `/api/super/entities/:id`

Get any entity by ID. Superadmins can access both global entities and organization-scoped entities through this endpoint.

**Path Parameters:**
- `id` (required) - Entity ID

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "ent456",
    "entityTypeId": "type123",
    "organizationId": "org789",
    "version": 1,
    "status": "published",
    "visibility": "members",
    "slug": "internal-doc",
    "data": {
      "name": "Internal Document",
      "description": "Organization document"
    },
    "createdAt": "2026-01-10T10:00:00Z",
    "updatedAt": "2026-01-10T10:00:00Z",
    "createdBy": "user123",
    "updatedBy": "user123"
  }
}
```

### List Entities (All Organizations)

**GET** `/api/super/entities`

List entities across all organizations, including global entities.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Query Parameters:**
- `organizationId` (optional) - Filter by organization ID. Use `null` to filter for global entities only
- `typeId` (optional) - Filter by entity type ID
- `status` (optional) - Filter by status
- `visibility` (optional) - Filter by visibility
- `search` (optional) - Search in name and description
- `page` (optional, default: 1) - Page number
- `pageSize` (optional, default: 20) - Items per page

**Example - List only global entities:**
```
GET /api/super/entities?organizationId=null
```

**Response:** Same format as `/api/entities` but includes entities from all organizations

### List All Users

**GET** `/api/super/users`

List all users across the platform.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "user123",
        "email": "user@example.com",
        "role": "org_admin",
        "organizationId": "org789",
        "organizationName": "Acme Corp"
      }
    ],
    "total": 50
  }
}
```

---

## File Routes

File upload and serving routes. Upload and delete operations require authentication, while GET is public for serving files.

### Upload File

**POST** `/files/upload`

Upload a file to R2 storage.

**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: multipart/form-data
```

**Form Data:**
- `file` (required) - The file to upload
- `type` (optional) - File type category: `image`, `logo`, `favicon`, or `file` (default: `file`)

**File Type Categories:**
- `image` - Stored in `uploads/images/`
- `logo` - Stored in `uploads/logos/`
- `favicon` - Stored in `uploads/favicons/`
- `file` - Stored in `uploads/files/`

**Limits:**
- Maximum file size: 10MB
- Rate limit: 10 requests per minute per user

**Response:**
```json
{
  "success": true,
  "data": {
    "url": "/files/uploads/logos/1642000000-abc123.svg",
    "path": "uploads/logos/1642000000-abc123.svg",
    "name": "logo.svg",
    "size": 15234,
    "type": "image/svg+xml"
  }
}
```

**Error Responses:**
- `400` - No file provided, file too large, or invalid file type
- `401` - Unauthorized (missing or invalid token)
- `500` - Upload failed

### Get File

**GET** `/files/:path+`

Get/serve a file from R2 storage. Public endpoint - no authentication required.

**Path Parameters:**
- `path` (required) - File path in R2 storage (e.g., `uploads/logos/1642000000-abc123.svg`)

**Response:** File content with appropriate Content-Type header

**Headers:**
- `Content-Type` - MIME type of the file
- `Cache-Control: public, max-age=31536000` - 1 year cache
- `Access-Control-Allow-Origin: *` - CORS enabled

**Example:**
```
GET /files/uploads/logos/1642000000-abc123.svg
```

**Error Responses:**
- `404` - File not found
- `500` - Failed to retrieve file

### Delete File

**DELETE** `/files/:path+`

Delete a file from R2 storage. Requires authentication. Users can only delete files they uploaded, unless they are superadmin.

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Path Parameters:**
- `path` (required) - File path in R2 storage (e.g., `uploads/logos/1642000000-abc123.svg`)

**Response:**
```json
{
  "success": true,
  "data": {
    "path": "uploads/logos/1642000000-abc123.svg"
  }
}
```

**Error Responses:**
- `401` - Unauthorized (missing or invalid token)
- `403` - Not authorized to delete this file (not the uploader and not superadmin)
- `404` - File not found
- `500` - Failed to delete file

---

## CASL Authorization

The API uses CASL (Code Access Security Layer) for fine-grained authorization. Abilities are built per-request based on:

- User role (superadmin, org_admin, org_member)
- Organization memberships
- Current organization context

### Ability Actions

- `create` - Create new resources
- `read` - View resources
- `update` - Modify resources
- `delete` - Remove resources
- `manage` - Full control (create, read, update, delete)
- `approve` - Approve pending resources

### Ability Subjects

- `Entity` - Content entities
- `EntityType` - Entity type definitions
- `Organization` - Organizations
- `User` - User accounts
- `Platform` - Platform settings
- `all` - All resources (superadmin only)

### Permission Matrix

| Role | Entities | Users | Entity Types | Organizations |
|------|----------|-------|--------------|---------------|
| Superadmin | manage all | manage all | manage all | manage all |
| Org Admin | manage (own org) | read, create, update (own org) | read | read |
| Org Member | read (own org) | read (own org) | read | read |

---

## Rate Limiting

Rate limiting is applied to prevent abuse:

- **Authentication endpoints**: 5 requests per minute per IP
- **API endpoints**: 100 requests per minute per user
- **File uploads**: 10 requests per minute per user

Rate limit headers are included in responses:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1642000000
```

---

## Pagination

List endpoints support pagination via query parameters:

- `page` - Page number (default: 1)
- `pageSize` - Items per page (default: 20, max: 100)

Pagination metadata is included in responses:

```json
{
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 100,
    "hasMore": true
  }
}
```

---

## Versioning

Entity versioning is automatic. Each update creates a new version while preserving history:

- Versions are immutable
- Latest version is tracked via `latest.json` pointer
- Specific versions can be accessed via `?version=N` query parameter

---

## Webhooks

Webhooks are not yet implemented but planned for:

- Entity status changes (draft → pending → published)
- Organization membership changes
- Entity type updates

---

## Examples

### Complete Authentication Flow

```bash
# 1. Request magic link
curl -X POST http://localhost:8787/auth/magic-link \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com"}'

# 2. Click link in email (redirects to /auth/verify?token=...)
# 3. Frontend receives JWT token

# 4. Use token for authenticated requests
curl http://localhost:8787/api/user/me \
  -H "Authorization: Bearer <jwt_token>"
```

### Create Entity in Organization

```bash
curl -X POST http://localhost:8787/api/orgs/org789/entities \
  -H "Authorization: Bearer <jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "entityTypeId": "type123",
    "data": {
      "name": "New Product",
      "description": "Product description"
    },
    "visibility": "public"
  }'
```

### Create Global Entity (Superadmin Only)

```bash
curl -X POST http://localhost:8787/api/super/entities \
  -H "Authorization: Bearer <jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "entityTypeId": "type123",
    "data": {
      "name": "Global Announcement",
      "description": "Platform-wide announcement"
    },
    "visibility": "public",
    "organizationId": null
  }'
```

**Note:** Setting `organizationId: null` creates a global entity that is not tied to any organization. Only superadmins can create global entities.

### Deep Link Access

```bash
# Access entity via slug chain
curl http://localhost:8787/acme/products/dog-toy

# No authentication required for public entities
```

---

## Support

For API support or questions:

- **Documentation**: See `CONTEXT.md` for architecture details
- **Issues**: Report via GitHub Issues
- **Email**: api-support@1cc-portal.com

---

## Changelog

### 2026-01-11 - Route Restructure

- Reorganized routes by access level (`/public`, `/api`, `/api/user`, `/api/orgs`, `/api/super`)
- Added deep linking with slug-based URLs (`/:orgSlug/:typeSlug/:entitySlug`)
- Integrated CASL for fine-grained authorization
- Moved `/auth/me` to `/api/user/me`
- Moved `/api/platform/branding` to `/public/branding`
