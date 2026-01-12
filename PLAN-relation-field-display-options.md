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
- Entity list items already return a small display subset (`EntityListItem.data.name` plus `description` in the worker route).
- The LinkField UI expects a lightweight linked-entity payload, but backend/UI types are not fully aligned (needs attention during implementation).

## Goals / non-goals

- **Goal**: Add a single, consistent “entity reference display” model that works across UI contexts.
- **Goal**: Defaults live on the **related entity type**; per-field override lives on the **link field definition**.
- **Goal**: Backwards compatible: if configs are missing, we fall back to existing behavior (name-only).
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

## API / backend plan (worker)

### Key decision: where to compute the display?

Compute on the **backend** so the UI doesn’t need to:

- load related type definitions to interpret field types/options
- understand how to map field values into badges/images/etc.

### New lightweight “entity reference” response shape

Introduce a shared type in `packages/shared/src/types/entity.ts` (or a new file) used by both search and “load linked entity”:

```ts
export interface EntityReferenceDisplay {
  /** Always safe fallback */
  primaryText: string;
  secondaryText?: string;
  media?: { kind: 'image' | 'emoji'; value: string };
  badges?: Array<{ text: string; color?: string }>;
}

export interface EntityReference {
  id: string;
  entityTypeId: string;
  slug: string;
  organizationId: string | null;
  display: EntityReferenceDisplay;
}
```

### Endpoints to support (or adjust)

- **`GET /api/entities/search`**: return `EntityReference[]` (not empty list). Must support `typeId` filter used by LinkField.
- **`GET /api/entities/:id`** (or add a dedicated endpoint like `GET /api/entities/:id/reference`): return `EntityReference` for LinkField’s “load selection by id”.

### Display resolution algorithm (backend)

Add a worker helper (e.g. `apps/worker/src/lib/entity-reference-display.ts`):

1. Determine the **related entity type** (load `definition.json` for `entity.entityTypeId`)
2. Pick template based on context:
   - Start with `entityType.referenceDisplayConfig?.[context]`
   - If caller is a link field with override, merge/override:
     - `field.constraints.linkDisplayOverride?.[context]` wins
3. If no template found, default:
   - `primary = { fieldId: 'name', displayAs: 'text' }`
4. For each template part, resolve value:
   - `value = entity.data[fieldId]`
   - if `path` present and `value` is object, traverse
5. Coerce output:
   - `displayAs: image` => URL string (or ignore if invalid)
   - `displayAs: emoji` => short string
   - `displayAs: badge` => string + optional color (for select options, color can be read from field definition constraints)
6. Always produce at least `primaryText` (fallback to `Entity ${id}`).

### Performance considerations

- Cache entity type definitions in-memory per request (simple Map) since a single search may resolve many references of the same type.
- Keep the reference response payload small (no full entity data).

---

## Frontend plan (web)

### 1) Shared rendering component

Create a small component (e.g. `apps/web/src/components/EntityReferenceLabel.tsx`) that renders `EntityReferenceDisplay` consistently:

- Media: image circle or emoji
- Primary: bold text
- Secondary: muted text
- Badges: small pill(s)

### 2) Update LinkField to use `EntityReference`

Update `LinkField` so:

- search results are `EntityReference[]` and it uses `display` to render rows
- selected entity loads via the “reference” endpoint and renders the same `display`

### 3) TypeBuilder UX for defaults (per entity type)

Add a new card/section in `TypeBuilder`:

- **“Reference Display”** with tabs: Menu / List / Card
- Each context lets the superadmin choose:
  - media field (optional)
  - primary field (required; default `name`)
  - secondary field (optional)
  - badges (0..N fields)
  - optional `displayAs` per selection (auto/text/badge/image/emoji)
  - optional `path` input shown only for object-valued fields (advanced)

### 4) FieldEditor override UX (for link fields only)

In FieldEditorModal when `field.type === 'link'`:

- Add a toggle: “Override linked entity display”
- If enabled: same UI as above, stored in `constraints.linkDisplayOverride`

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

### Worker tests (`apps/worker`)

- Search returns references with display applied
- Field override beats type default
- Missing fields fall back gracefully

### Web tests (`apps/web`)

- LinkField renders media + primary + badges correctly given `EntityReferenceDisplay`

---

## Implementation order (recommended)

1. **Shared types + schemas**: add `referenceDisplayConfig` + `linkDisplayOverride`
2. **Worker**: implement `EntityReference` response + display builder + update search + add reference endpoint
3. **Web**: create `EntityReferenceLabel` and update LinkField to use it
4. **Web**: TypeBuilder “Reference Display” editor UI (defaults)
5. **Web**: Link field override UI in FieldEditorModal
6. **Tests** across shared + worker + web

