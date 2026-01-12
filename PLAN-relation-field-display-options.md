<!--
Plan: Relation field “display options” (menu / list / card)
Created: 2026-01-12
Scope: Design only (no implementation in this change)
-->

## Summary

We want **relation fields** (today: `FieldDefinition.type === 'link'`) to show **richer, type-defined labels** when a related entity is displayed in:

- **menu**: selection dropdowns (e.g. the LinkField search results)
- **list**: compact rows (e.g. related-entity lists)
- **card**: richer tiles (e.g. related-entity cards)

The default display should be configured **on the related entity type definition**, and it must be **overrideable per link field**.

Examples:

- **Country**: show flag + name
- **Brand link**: show logo + name
- **Project link**: show name + status badge

## Current state (what exists today)

- “Relation field” is modeled as **`FieldDefinition.type === 'link'`** with a target type in constraints (`constraints.linkEntityTypeId` in the TypeBuilder).
- Bundles are already fetched client-side and cached, and there is already a local “get entity by ID from bundles” helper (see `apps/web/src/stores/sync.tsx`).
- **Constraint for this plan**: all “relation display” logic should happen in the **frontend**, using **local TanStack DB** hydrated from the relevant entity type bundle as the source of related-entity data.

## Goals / non-goals

- **Goal**: Add a single, consistent “entity reference display” model that works across UI contexts.
- **Goal**: Defaults live on the **related entity type**; per-field override lives on the **link field definition**.
- **Goal**: Backwards compatible: if configs are missing, we fall back to existing behavior (name-only).
- **Goal**: No worker/API changes beyond the **additional parameters** on entity type + field definitions (stored/returned as part of entity type definitions/manifests).
- **Non-goal**: Add/modify backend endpoints for reference rendering or searching. Link menus/lists should be powered by **local bundle data in TanStack DB**.
- **Non-goal**: Build a full templating language or arbitrary JSX; keep it simple and predictable.

---

## Proposed data model (shared types + Zod schemas)

### 1) New “reference display” types (in `packages/shared`)

Add to `packages/shared/src/types/entity-type.ts`:

```ts
export type EntityReferenceContext = 'menu' | 'list' | 'card';

export type EntityReferencePartKind = 'field';

export type EntityReferencePartDisplayAs =
  | 'auto'   // derive from field type when possible
  | 'text'   // string rendering
  | 'badge'  // label/badge rendering (good for select/status)
  | 'image'  // URL image (image/logo fields)
  | 'emoji'; // short emoji/text glyph (e.g. 🇺🇸)

export interface EntityReferencePart {
  kind: EntityReferencePartKind;     // currently only 'field' (keep extensible)
  fieldId: string;                  // field on the RELATED entity type
  /**
   * Optional dotted path for object-valued fields.
   * Example: country field stores { name, flag } so: { fieldId: 'country', path: 'flag' }
   */
  path?: string;
  displayAs?: EntityReferencePartDisplayAs;
}

/**
 * A structured template so the UI/API can render consistently.
 * This avoids “just a list of fields” ambiguity.
 */
export interface EntityReferenceDisplayTemplate {
  /** Leading visual (logo/flag) */
  media?: EntityReferencePart;
  /** Main label (required for good UX) */
  primary: EntityReferencePart;
  /** Secondary text (optional) */
  secondary?: EntityReferencePart;
  /** Small badges/pills (optional) */
  badges?: EntityReferencePart[];
}

export type EntityReferenceDisplayConfig = Partial<
  Record<EntityReferenceContext, EntityReferenceDisplayTemplate>
>;
```

Then extend `EntityType`:

```ts
export interface EntityType {
  // ...
  /**
   * Default rendering for THIS type when it appears as a linked/referenced entity.
   * If absent, defaults to { primary: { fieldId: 'name' } }.
   */
  referenceDisplayConfig?: EntityReferenceDisplayConfig;
}
```

### 2) Link field override (per-field)

Extend `FieldConstraints` (still in `packages/shared/src/types/entity-type.ts`) for link fields:

```ts
export interface FieldConstraints {
  // ...
  linkEntityTypeId?: string;
  allowMultiple?: boolean;

  /**
   * Optional override for how the RELATED entity should display for THIS field.
   * If set, takes precedence over the related type’s referenceDisplayConfig for the relevant context(s).
   */
  linkDisplayOverride?: EntityReferenceDisplayConfig;
}
```

### 3) Zod validation updates

Update `packages/shared/src/schemas/entity-type.ts` to validate:

- `referenceDisplayConfig` at the entity type level (optional)
- `constraints.linkDisplayOverride` for link fields (optional)
- `EntityReferencePart.path` as a conservative dotted identifier (e.g. `/^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)*$/`)
- `fieldId` must be a valid field ID string (same regex as existing field IDs)

Back-compat: all new fields **optional** so existing stored definitions validate unchanged.

---

## Frontend plan (web)

### 1) Data source: TanStack DB hydrated from bundles

The LinkField (and any other “related entity” menus/lists/cards) should pull related-entity data from **local TanStack DB** that is hydrated from the relevant **entity type bundle**.

### 1.1) Manifest-driven background hydration (“app.json” as client hydration state)

To make “relation display” work reliably offline and without ad-hoc API lookups, we need a deterministic way for the client to know **which bundles should be present locally**.

This plan treats **“app.json” as a client-side hydration state document** (stored in TanStack DB and/or localStorage), derived from server manifests:

- **Purpose**: record which manifest(s) are active for the current session and which bundle versions are expected/loaded.
- **Not a new server API**: we can use the already-existing manifest endpoints to discover bundles; the “app.json” naming here is about the client’s persisted state.

#### Manifests we should treat as distinct inputs

The worker already exposes separate manifests by audience/scope:

- **Public**: `GET /manifests/public`
- **Authenticated (platform)**: `GET /manifests/platform` (returns authenticated manifest when logged in, otherwise public)
- **Organization (members/admin)**: `GET /manifests/org/:orgId`

For client hydration, treat these as **separate manifests**, because they correspond to different bundle namespaces:

- public bundles → `/manifests/bundles/public/:typeId`
- authenticated bundles → `/manifests/bundles/platform/:typeId`
- org bundles → `/manifests/bundles/org/:orgId/:typeId`

#### Bundle sets to load (per your requirement)

For an authenticated client (org member/admin):

- **Always** hydrate all **public bundles** for all public entity types (from the public manifest).
- **Also** hydrate all **authenticated/platform bundles** for authenticated-global entity types (from the platform manifest).
  - These are “global objects” that require auth (visibility scope `authenticated`).
- **Also** hydrate all **org bundles** for the user’s selected/active organization (from the org manifest).

For a public (unauthenticated) client:

- Hydrate **public manifest + all public bundles**.

For a superadmin client:

- Hydrate **public bundles** (same as everyone).
- Hydrate **authenticated/platform bundles** (platform manifest + platform bundles).
- Additionally, when acting “within” an organization (e.g. editing org-scoped entities), hydrate the **org bundles for the currently selected org**.
  - Keep this “selected org” explicit (already part of auth store behavior).

#### Proposed client hydration state shape (stored locally)

In TanStack DB (or localStorage initially), store a single record like:

```ts
type HydrationScopeKey =
  | 'public'
  | 'platform'
  | `org:${string}`; // orgId

interface ClientHydrationState {
  updatedAt: string;
  /** Which scopes are enabled for this session */
  enabledScopes: HydrationScopeKey[];
  /** Last fetched manifest versions by scope */
  manifestVersionByScope: Record<HydrationScopeKey, number | undefined>;
  /** Expected bundle versions by scope+typeId */
  bundleVersionByScopeAndType: Record<string, number | undefined>; // `${scope}|${typeId}`
}
```

Hydration algorithm:

1. Determine enabled scopes:
   - unauth → `['public']`
   - auth (non-super) → `['public', 'platform', `org:${currentOrgId}`]`
   - superadmin → `['public', 'platform']` plus optional `org:${currentOrgId}`
2. Fetch each scope’s manifest (in background).
3. For each manifest entity type, ensure the matching bundle exists locally at the required version; if not, fetch bundle and upsert entities into TanStack DB collection(s).

This is the foundation needed for relation displays to work consistently, because LinkField/search and rendering will query TanStack DB instead of hitting `/api/entities/search`.

### 1.2) Critical-path route payloads (home + deeplinks) vs background bundles

To meet the UX requirement (“fast first paint” on **home** and **deeplinks**) while still moving toward full offline hydration, split loading into:

- **Critical path**: fetch *just enough* to render the current route.
- **Background**: hydrate broader bundles/manifests into TanStack DB for navigation, search, and relation displays.

#### Critical path inputs

1) **App config** (always fetched first)

- Used for: feature flags (offline mode), branding, sync intervals, and deciding which hydration scopes are applicable.
- Server storage already exists by type (`config/app.json` and `private/platform/app.json`), but the web app currently only fetches branding via `/public/branding`.
- Plan expectation: the client can fetch a single “startup config” payload early. (Implementation can be either:
  - a dedicated endpoint returning `AppConfig` (recommended), or
  - composing existing endpoints (`/public/branding` + a config endpoint) into one client call.)

2) **Route payload file** (route-specific JSON)

For each user-facing route we should have a **single JSON payload** containing:

- the primary entity/entities needed for the page
- *supporting data* needed to render without waiting for background bundles

This can be thought of as a “route file” (as you described). It is separate from manifests/bundles and can be cached aggressively.

#### Proposed route payload shapes

Keep these payloads small and explicitly shaped for routes:

- **Home route payload**:
  - branding + minimal nav model (org landing targets, top entity types)
  - optional “featured” entities (already in `BundleEntity` shape)

- **Public deeplink payload** (`/:orgSlug/:typeSlug/:entitySlug`):
  - `organization` (id, name, slug)
  - `entityType` (id, slug, name) and optionally **entity type definition** if needed for rendering
  - `entity` (full entity or `BundleEntity`-like shape)
  - `supportingEntities` (optional): minimal entities needed to render relation labels immediately (e.g. brand logo/name for a linked brand)

- **Authenticated deeplink payload** (same idea, but visibility-aware):
  - The payload resolver chooses source scope:
    - public (if entity is public)
    - platform/authenticated (if entity is authenticated-global)
    - org/members (if entity is org-scoped and user is a member)
  - Includes the same `supportingEntities` concept.

Supporting entities should be sufficient to render relation displays on that page **before** full bundle hydration completes.

#### Load sequences by client type (as requested)

- **Public user → Home**
  - critical path:
    - fetch app config
    - fetch home route payload
  - background:
    - hydrate public manifest + public bundles into TanStack DB

- **Public user → Deeplink**
  - critical path:
    - fetch app config
    - fetch deeplink route payload (entity + supportingEntities)
  - background:
    - hydrate public manifest + public bundles

- **Authenticated user → Deeplink**
  - critical path:
    - fetch app config
    - fetch deeplink route payload (visibility-aware; entity + supportingEntities)
  - background:
    - hydrate public manifest + bundles
    - hydrate platform/authenticated manifest + bundles (**authenticated global objects**)
    - hydrate org/members manifest + bundles (**if** user is a member of the active org)
    - hydrate org “supporting files” as needed (org profile/permissions) to drive UI choices and offline navigation

Note: this background sequence aligns with the earlier scope model (`public`, `platform`, `org:${orgId}`), but adds an explicit “route payload first” requirement.

Proposed DB model (exact API depends on how TanStack DB is integrated in this repo):

- **Collection**: `entitiesByType[typeId]`
- **Record shape**: `BundleEntity` (or a normalized version with at least `id`, `slug`, `data`, `status`, `updatedAt`)
- **Queries**:
  - `getById(entityId)` for the selected value
  - `searchByType(typeId, query)` for dropdown search

Notes:

- This is intentionally frontend-only and avoids reliance on `/api/entities/search` (which is currently stubbed).
- “Appropriate bundle” depends on the UI context:
  - browse/public pages → public bundle
  - admin editor → org/members bundle
  - superadmin editor → platform/authenticated or org bundle (depending on entity scope)

### 2) Frontend-only “reference display builder”

Implement a pure helper (e.g. `apps/web/src/lib/entity-reference-display.ts`) that builds a UI-friendly display object from:

- the related entity’s **data** (from TanStack DB)
- the related entity type’s **field definitions** (so we can do smarter things like select-option colors)
- the context (`menu` | `list` | `card`)
- an optional per-field override (from `constraints.linkDisplayOverride`)

Suggested output:

- `media?: { kind: 'image' | 'emoji'; value: string }`
- `primaryText: string`
- `secondaryText?: string`
- `badges?: Array<{ text: string; color?: string }>`

Resolution rules:

1. Pick template: type default → apply override → fallback to `{ primary: { fieldId: 'name' } }`
2. Resolve part values from `entity.data[fieldId]` with optional dotted `path` traversal
3. Coerce by `displayAs` (`image`/`emoji`/`badge`/`text`/`auto`)
4. Guarantee `primaryText` (fallback `Entity {id}`)

### 3) Shared rendering component

Create a small component (e.g. `apps/web/src/components/EntityReferenceLabel.tsx`) that renders the built display object consistently:

- Media: image circle or emoji
- Primary: bold text
- Secondary: muted text
- Badges: small pill(s)

### 4) Update LinkField to use TanStack DB (no API search)

Update `LinkField` so:

- It does **not** call `/api/entities/search` nor `/api/entities/:id` for lookup.
- It uses `constraints.linkEntityTypeId` to scope to the correct local entity-type collection.
- It searches locally (name-first; optionally secondary fields depending on the template).
- It renders each option via `EntityReferenceLabel`.

### 5) TypeBuilder UX for defaults (per entity type)

Add a new card/section in `TypeBuilder`:

- **“Reference Display”** with tabs: Menu / List / Card
- Each context lets the superadmin choose:
  - media field (optional)
  - primary field (required; default `name`)
  - secondary field (optional)
  - badges (0..N fields)
  - optional `displayAs` per selection (auto/text/badge/image/emoji)
  - optional `path` input shown only for object-valued fields (advanced)

### 6) FieldEditor override UX (for link fields only)

In FieldEditorModal when `field.type === 'link'`:

- Add a toggle: “Override linked entity display”
- If enabled: same UI as above, stored in `constraints.linkDisplayOverride`

<!--
NOTE: The “TypeBuilder UX” and “FieldEditor override UX” sections were moved earlier in this doc
as steps 5 and 6 under “Frontend plan (web)”, since this plan is frontend-only.
-->

---

## Migration / backwards compatibility

- **No data migration required** initially because all new config fields are optional.
- Default behavior when configs missing:
  - menus/lists/cards show the related entity’s `data.name` (or `Entity {id}` fallback)
- Implementation should tolerate missing/invalid referenced fields:
  - skip that part, fall back to name-only

---

## Testing plan

### Shared schema tests (`packages/shared`)

- Valid configs parse:
  - country: media `country.flag`, primary `country.name`
  - brand: media `logo` as image, primary `name`
  - project: primary `name`, badge `status` as badge
- Invalid configs reject:
  - bad context keys
  - bad `path` patterns
  - missing `primary`

### Web tests (`apps/web`)

- The display builder returns expected media/primary/badges for representative entities
- LinkField renders media + primary + badges correctly for built display objects
- Override beats type defaults

---

## Implementation order (recommended)

1. **Shared types + schemas**: add `referenceDisplayConfig` + `linkDisplayOverride`
2. **Web**: implement manifest-driven TanStack DB hydration (“app.json” client hydration state + background bundle loading)
3. **Web**: implement frontend display builder + `EntityReferenceLabel`
4. **Web**: update LinkField to search/resolve via TanStack DB hydrated from bundles
5. **Web**: TypeBuilder “Reference Display” editor UI (defaults)
6. **Web**: Link field override UI in FieldEditorModal
7. **Tests** across shared + web

