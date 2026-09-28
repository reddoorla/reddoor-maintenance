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
 */
import { siteSlug } from "./site-row.js";
import { mintSiteId } from "./site-id.js";
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

export type EnsureSiteDeps = {
  store: SiteStore;
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
};

const slugTaken = (err: unknown): boolean =>
  typeof err === "object" && err !== null && (err as { code?: unknown }).code === "SLUG_TAKEN";

export async function ensureSite(
  input: EnsureSiteInput,
  deps: EnsureSiteDeps,
): Promise<EnsureSiteResult> {
  const { store } = deps;
  const slug = siteSlug(input.slug);
  if (!slug) throw new Error(`ensure-site: '${input.slug}' does not slugify to a usable slug`);
  if (input.displayName !== undefined && siteSlug(input.displayName) !== slug) {
    throw new Error(
      `ensure-site: display name '${input.displayName}' slugifies to '${siteSlug(input.displayName)}', not '${slug}' — a rename never changes the slug`,
    );
  }

  const existing = await store.findBySlug(slug);

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
    return { status: "created", siteId: id, updatedFields: [], skippedMismatches: [] };
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
  if (updatedFields.length > 0 && !(await store.updateIdentity(existing.id, patch))) {
    throw new Error(`ensure-site: site ${existing.id} vanished from Turso mid-run`);
  }
  return { status: "exists", siteId: existing.id, updatedFields, skippedMismatches };
}
