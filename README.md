# 1C Portal

A multi-tenant content management system built on Cloudflare's edge infrastructure.

## Features

- **Multi-Tenancy**: Complete organization isolation with configurable permissions
- **Flexible Content Model**: Custom entity types with 13 configurable field types
- **Approval Workflow**: Draft → Pending → Published lifecycle with superadmin approval
- **Offline Capability**: Local data persistence for fast, offline-capable viewing
- **Magic Link Auth**: Passwordless authentication with JWT sessions
- **Role-Based Access**: Superadmin, Org Admin, and Org Member roles

## Tech Stack

| Component | Technology |
|-----------|------------|
| Backend | Cloudflare Workers |
| Storage | Cloudflare R2 |
| Frontend | Preact + UnoCSS |
| Styling | UnoCSS (utility-first) |
| State Machines | XState |
| Validation | Zod |
| Email | Resend |

## Getting Started

### Prerequisites

- Node.js 20+
- npm 10+
- Cloudflare account (for deployment)

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd 1cc-portal-2

# Install dependencies
npm install

# Set up environment
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
# Edit .dev.vars with your values
```

### Development

```bash
# Start all services
npm run dev

# Start worker only (API)
npm run dev:worker

# Start frontend only
npm run dev:web
```

The API runs at `http://localhost:8787` and the frontend at `http://localhost:5173`.

### Building

```bash
# Build all packages
npm run build
```

### Deployment

```bash
# Set secrets
wrangler secret put JWT_SECRET
wrangler secret put RESEND_API_KEY

# Deploy worker
npm run deploy:worker
```

## Project Structure

```
1cc-portal-2/
├── apps/
│   ├── worker/           # Cloudflare Worker API
│   └── web/              # Preact frontend
├── packages/
│   ├── shared/           # Shared types and schemas
│   └── xstate-machines/  # XState workflow definitions
├── package.json          # Workspace root
├── turbo.json            # Turborepo config
└── CONTEXT.md            # Detailed project context
```

## API Documentation

### Authentication

```bash
# Request magic link
POST /auth/magic-link
Content-Type: application/json
{"email": "user@example.com"}

# Verify and get token
GET /auth/verify?token=<magic_token>
```

### Entities

```bash
# Create entity
POST /api/entities
Authorization: Bearer <token>
{"entityTypeId": "abc1234", "data": {"name": "My Entity"}}

# List entities
GET /api/entities?typeId=abc1234&status=published

# Update entity
PATCH /api/entities/<id>
{"data": {"name": "Updated Name"}}

# Transition status
POST /api/entities/<id>/transition
{"action": "submitForApproval"}
```

## User Roles

| Role | Capabilities |
|------|-------------|
| Superadmin | Full platform access, manage types/orgs, approve content |
| Org Admin | Manage org content and users, submit for approval |
| Org Member | View published content, flag for alerts |

## Entity Status Lifecycle

```
                    ┌─ reject ─┐
                    ↓          │
Draft ─────► Pending ─────► Published ─────► Archived
  ↑            │                               │
  └────────────┘                               │
       (rejected)                              │
  ↑                                            │
  └─────────── restore ────────────────────────┘
```

## Contributing

1. Create a feature branch
2. Make your changes
3. Submit a pull request

## License

MIT
