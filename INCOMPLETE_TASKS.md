# Incomplete Tasks - 1C Portal

This document lists all tasks that have not been completed in the codebase.

## 🔴 Critical TODOs in Code

### 1. Search Functionality (Not Implemented)
**Location**: `apps/worker/src/routes/entities.ts:403`
**Status**: Returns empty results
**Current State**: 
- Endpoint exists at `GET /api/entities/search`
- Accepts query parameters: `q`, `typeId`, `visibility`, `status`, `sortBy`, `sortOrder`, `limit`, `offset`
- Currently returns empty array `[]`

**What Needs to be Done**:
- Implement proper search with indexing (Algolia, Elasticsearch, or D1 FTS)
- Query search index with search term
- Filter by typeId, visibility, status
- Apply access controls based on userRole and userOrgId
- Sort by relevance or other fields
- Return paginated results with highlights

**Impact**: Users cannot search for entities across the platform

---

### 2. Organization Entity Listing (Not Implemented)
**Location**: `apps/worker/src/routes/orgs/entities.ts:159`
**Status**: Returns empty array
**Current State**:
- Endpoint exists at `GET /api/orgs/:orgId/entities`
- Accepts query parameters via `entityQueryParamsSchema`
- Currently returns: `{ items: [], total: 0, page: 1, pageSize: 20, hasMore: false }`

**What Needs to be Done**:
- Implement full listing logic similar to existing entity listing
- Filter entities by organization ID
- Support pagination, filtering, and sorting
- Apply proper access controls

**Impact**: Organization admins cannot list entities in their organization through this endpoint

---

### 3. User Added Notification Email (Not Implemented)
**Location**: `apps/worker/src/routes/organizations.ts:556`
**Status**: Only logs to console
**Current State**:
- When an existing user is added to an organization, the code logs: `"User added to org, notification would be sent to: {email}"`
- No actual email is sent

**What Needs to be Done**:
- Send a "you've been added" notification email instead of invitation
- Use the email service (`apps/worker/src/lib/email.ts`) which already has infrastructure
- Create email template for "user added to organization" notification
- Include organization name and role in the email

**Impact**: Users don't get notified when they're added to an organization

---

## 📋 Pending Features (from CONTEXT.md)

### 4. R2 Bucket Initialization
**Status**: Not started
**Description**: Need to initialize R2 buckets with required structure and default files
**What Needs to be Done**:
- Create initialization script/process
- Set up default `app.json` configuration
- Create required directory structure
- Initialize default membership keys and organization tiers

---

### 5. TanStack DB Integration for True Offline
**Status**: Not started
**Description**: Currently using local caching via signals, but needs true offline database
**What Needs to be Done**:
- Integrate TanStack DB for client-side data persistence
- Migrate from signal-based caching to TanStack DB
- Implement sync logic between local DB and server
- Handle offline/online state transitions
- Test offline functionality

**Impact**: Users cannot fully use the app offline

---

### 6. Alert Notification System (Email Digests)
**Status**: Partially implemented
**Current State**:
- ✅ Frontend UI exists (`apps/web/src/pages/Alerts.tsx`)
- ✅ User preferences schema includes alert settings (`packages/shared/src/types/user.ts`)
- ✅ Email service infrastructure exists (`apps/worker/src/lib/email.ts`)
- ✅ Entity flagging system exists (`apps/worker/src/routes/users.ts`)
- ❌ **Missing**: Email digest sending logic
- ❌ **Missing**: Scheduled job/cron to send digests
- ❌ **Missing**: Email templates for alert digests

**What Needs to be Done**:
- Create email digest template
- Implement scheduled job (Cloudflare Cron Triggers) to send digests
- Query flagged entities that have been updated
- Group updates by user's alert frequency (daily/weekly/monthly)
- Send digest emails at user's preferred time
- Track last digest sent timestamp

**Impact**: Users flag entities but never receive email notifications about updates

---

### 7. Performance Optimization
**Status**: Not started
**Description**: General performance improvements needed
**What Needs to be Done**:
- Profile application performance
- Optimize bundle sizes
- Implement lazy loading where appropriate
- Add caching strategies
- Optimize R2 queries
- Reduce API response times

---

## 🔍 Additional Findings

### Email Templates
The email service (`apps/worker/src/lib/email.ts`) defines these template types but templates are not implemented:
- `'alert-digest'` - For alert notification emails
- `'entity-approved'` - For entity approval notifications
- `'entity-rejected'` - For entity rejection notifications

**Note**: `'magic-link'` and `'invitation'` templates appear to be implemented in `apps/worker/src/routes/auth.ts` and `apps/worker/src/routes/organizations.ts`

---

## Summary

| Priority | Task | Status | Impact |
|----------|------|--------|--------|
| 🔴 High | Search functionality | Not implemented | Users cannot search entities |
| 🔴 High | Org entity listing | Not implemented | Org admins cannot list entities |
| 🟡 Medium | User added notification | Partially done | Users not notified when added to org |
| 🟡 Medium | Alert email digests | Partially done | Users don't receive alert emails |
| 🟢 Low | R2 bucket initialization | Not started | Deployment setup issue |
| 🟢 Low | TanStack DB integration | Not started | Offline functionality missing |
| 🟢 Low | Performance optimization | Not started | General improvements needed |

---

## Next Steps

1. **Immediate**: Implement org entity listing endpoint (quick win, similar to existing listing)
2. **High Priority**: Implement search functionality (core feature)
3. **Medium Priority**: Complete alert notification system (email digests)
4. **Medium Priority**: Add user added notification email
5. **Low Priority**: R2 initialization, TanStack DB, performance optimization

---

*Generated: 2026-01-15*
*Last Updated: Based on codebase analysis*
