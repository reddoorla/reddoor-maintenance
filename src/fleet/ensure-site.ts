/**
 * `ensure-site`, Turso-native (#539 Phase 6 step 3, #646; operator decision
 * 2026-09-17).
 *
 * Find-or-create a site by SLUG so it exists in the fleet from day one. Turso is
 * the source of truth: a new site gets a minted `site_<ULID>` id and its three
 * rows (`sites`, `site_health`, `site_schedule`) in one transaction. The command
 * is re-run to RESUME a partial bootstrap, so everything keys on the slug — a
 * re-run finds the site and never mints a second id.
 *
 * Fill-blanks-only on the exists path: a resumed bootstrap must never clobber an
 * operator's edit. The one exception is `displayName` (#664): `--name` targets the
 * name and nothing else, so a differing value IS the operator's rename. A rename
 * changes `sites.name` only; `sites.slug` is the stable external handle and never
 * moves, which is why a name that would slugify differently is refused outright.
 *
 * ## The Airtable shadow for a NEW site: none
 *
 * A new site is not written to Airtable at all. An Airtable record would carry
 * its own `rec` id that is NOT the site id, and every batch job still enumerating
 * the fleet from Airtable (#646 step 4, not yet done) would then write Turso by
 * that `rec` id — an UPDATE matching no row, which under the freeze THROWS
 * (`mirrored=missed`). A half-visible site that reds the nightly sweeps is worse
 * than one those sweeps cannot see yet. The rollback week is over and a rollback
 * to Airtable has never been rehearsed, so there is no recovery the record would
 * be keeping trustworthy. Every Airtable shadow writer skips a `site_` id with an
 * `AIRTABLE_SHADOW skipped=non-rec-id` line (`src/fleet/site-id.ts`).
 *
 * The cost, named: until step 4 moves batch enumeration to Turso, a site created
 * here is invisible to the Airtable-enumerated jobs (audits incl. form-e2e,
 * report drafting, digest, github-signals, renovate-dispatch…). Form ingest,
 * the dashboard and every Turso reader see it immediately.
 *
 * ## Pre-existing `rec` sites
 *
 * Both id shapes coexist permanently. A `rec` site found in Turso keeps its id,
 * and its fill-blanks / rename is still shadowed to Airtable (Airtable stays the
 * shadow until step 6), Airtable first so a re-run converges both stores.
 *
 * The #645 heal survives in one form: when Turso has no row for the slug but
 * Airtable does, the Airtable record is ADOPTED under its own `rec` id instead of
 * minting a second identity for the same site. That lookup runs only when an
 * Airtable client is wired, and a lookup that FAILS refuses the create — minting
 * while unable to rule out a duplicate identity would be the one unrecoverable
 * outcome here.
 */
import { siteSlug } from "./site-row.js";
import { isAirtableRecordId, mintSiteId, skipsAirtableShadow } from "./site-id.js";
import type { NewSiteRow, SiteIdentityPatch } from "../db/fleet-state.js";

export type { SiteIdentityPatch } from "../db/fleet-state.js";

export type EnsureSiteInput = {
  /** Canonical slug; normalised through `siteSlug`. The stored `sites.slug`. */
  slug: string;
  /** Human display name. Written on create (default: the slug) and, unlike every
   *  other input, UPDATED on an existing site when it differs (#664) — it is used
   *  verbatim in client-facing copy (forms auto-reply intro, report subjects).
   *  Must slugify to the same slug, or it is refused. */
  displayName?: string;
  url?: string;
  pointOfContact?: string;
  /** owner/repo. Default on create: `reddoorla/<slug>`. */
  gitRepo?: string;
};

/** The identity columns of an existing site, as `ensure-site` compares them. */
export type ExistingSite = {
  id: string;
  name: string;
  url: string | null;
  pointOfContact: string | null;
  gitRepo: string | null;
};

/** The Turso operations the creator needs. `src/db/site-create.ts` implements it. */
export type SiteStore = {
  findBySlug: (slug: string) => Promise<ExistingSite | null>;
  /** Insert all three rows atomically. Rejects with `code: "SLUG_TAKEN"` when the
   *  `sites.slug` UNIQUE index refuses the row. */
  create: (site: NewSiteRow) => Promise<void>;
  /** Resolves whether a row matched. Never touches the slug (by type). */
  updateIdentity: (siteId: string, patch: SiteIdentityPatch) => Promise<boolean>;
};

/** The Airtable layer, as the creator still needs it until #646 step 6. Every
 *  member is legacy: the lookup + adopt keep the #645 heal, `update` shadows a
 *  `rec` site's fill. The CLI wires it only when Airtable credentials exist. */
export type LegacyAirtableSites = {
  findBySlug: (slug: string) => Promise<{ id: string; fields: Record<string, unknown> } | null>;
  /** Insert Turso rows for an Airtable record that has none (the #645 heal). */
  adopt: (rec: { id: string; fields: Record<string, unknown> }) => Promise<void>;
  update: (recordId: string, patch: SiteIdentityPatch) => Promise<void>;
};

export type EnsureSiteDeps = {
  store: SiteStore;
  airtable?: LegacyAirtableSites | null;
  /** Injectable for tests; defaults to {@link mintSiteId}. */
  mintId?: () => string;
};

export type EnsureSiteResult = {
  status: "created" | "exists";
  siteId: string;
  /** Identity fields written on the exists path (`name` = a `--name` rename). */
  updatedFields: Array<keyof SiteIdentityPatch>;
  /** Inputs that DIFFERED from an existing non-blank value and were left untouched
   *  (fill-blanks-only) — surfaced so a resumed bootstrap with a corrected value
   *  does not silently discard it. */
  skippedMismatches: Array<keyof SiteIdentityPatch>;
  /** #645: the site existed in Airtable with NO Turso row, and this run adopted it.
   *  Its leads were being answered `unknown-site` until now. */
  healedDbRow: boolean;
  /** What happened to the Airtable shadow: `skipped` for a `site_` id (created or
   *  updated), `written` when a `rec` site's changes were shadowed, `none` when
   *  there was nothing to shadow or no Airtable client was wired. */
  airtableShadow: "skipped" | "written" | "none";
};

const slugTaken = (err: unknown): boolean =>
  typeof err === "object" && err !== null && (err as { code?: unknown }).code === "SLUG_TAKEN";

export async function ensureSite(
  input: EnsureSiteInput,
  deps: EnsureSiteDeps,
): Promise<EnsureSiteResult> {
  const { store } = deps;
  const airtable = deps.airtable ?? null;
  const slug = siteSlug(input.slug);
  if (!slug) throw new Error(`ensure-site: '${input.slug}' does not slugify to a usable slug`);
  if (input.displayName !== undefined && siteSlug(input.displayName) !== slug) {
    throw new Error(
      `ensure-site: display name '${input.displayName}' slugifies to '${siteSlug(input.displayName)}', not '${slug}' — a rename never changes the slug`,
    );
  }

  let existing = await store.findBySlug(slug);
  let healedDbRow = false;

  if (!existing && airtable) {
    // Throws through on failure — see "Pre-existing rec sites" above.
    const legacy = await airtable.findBySlug(slug);
    if (legacy) {
      await airtable.adopt(legacy);
      existing = await store.findBySlug(slug);
      if (!existing) {
        throw new Error(
          `ensure-site: adopted Airtable record ${legacy.id} for '${slug}' but Turso still has no row for the slug`,
        );
      }
      healedDbRow = true;
    }
  }

  if (!existing) {
    const id = (deps.mintId ?? mintSiteId)();
    try {
      await store.create({
        id,
        slug,
        name: input.displayName ?? slug,
        status: "building",
        url: input.url ?? null,
        pointOfContact: input.pointOfContact ?? null,
        gitRepo: input.gitRepo ?? `reddoorla/${slug}`,
      });
    } catch (err) {
      if (!slugTaken(err)) throw err;
      const owner = await store.findBySlug(slug).catch(() => null);
      throw new Error(
        `ensure-site: slug '${slug}' is already taken${owner ? ` by site ${owner.id}` : ""} — it was created after this run looked; re-run to resume that site`,
        { cause: err },
      );
    }
    skipsAirtableShadow("ensureSite.create", id);
    return {
      status: "created",
      siteId: id,
      updatedFields: [],
      skippedMismatches: [],
      healedDbRow: false,
      airtableShadow: "skipped",
    };
  }

  const patch: SiteIdentityPatch = {};
  const skippedMismatches: Array<keyof SiteIdentityPatch> = [];
  const consider = (
    key: "url" | "pointOfContact" | "gitRepo",
    provided: string | undefined,
    current: string | null,
  ) => {
    if (!provided) return;
    if (current === null || current === "") patch[key] = provided;
    else if (current !== provided) skippedMismatches.push(key);
  };
  consider("url", input.url, existing.url);
  consider("pointOfContact", input.pointOfContact, existing.pointOfContact);
  consider("gitRepo", input.gitRepo, existing.gitRepo);
  if (input.displayName !== undefined && existing.name !== input.displayName) {
    patch.name = input.displayName;
  }

  const updatedFields = Object.keys(patch) as Array<keyof SiteIdentityPatch>;
  let airtableShadow: EnsureSiteResult["airtableShadow"] = "none";
  if (updatedFields.length > 0) {
    if (skipsAirtableShadow("ensureSite.update", existing.id)) {
      airtableShadow = "skipped";
    } else if (airtable && isAirtableRecordId(existing.id)) {
      await airtable.update(existing.id, patch);
      airtableShadow = "written";
    }
    if (!(await store.updateIdentity(existing.id, patch))) {
      throw new Error(`ensure-site: site ${existing.id} vanished from Turso mid-run`);
    }
  }
  return {
    status: "exists",
    siteId: existing.id,
    updatedFields,
    skippedMismatches,
    healedDbRow,
    airtableShadow,
  };
}
