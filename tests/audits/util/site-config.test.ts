import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PLACEHOLDER_PRISMIC_REPO,
  readSiteConfig,
  readsPlaceholderPrismicRepo,
} from "../../../src/audits/util/site-config.js";

describe("readSiteConfig", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "reddoor-site-config-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns {} when no package.json exists", async () => {
    expect(await readSiteConfig(dir)).toEqual({});
  });

  it("returns {} when package.json is malformed JSON", async () => {
    await writeFile(join(dir, "package.json"), "{ not valid json");
    expect(await readSiteConfig(dir)).toEqual({});
  });

  it("returns {} when package.json has no reddoor key", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "x" }));
    expect(await readSiteConfig(dir)).toEqual({});
  });

  it("returns {} when reddoor is the wrong type (string instead of object)", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ reddoor: "nope" }));
    expect(await readSiteConfig(dir)).toEqual({});
  });

  it("extracts lighthouseUrl when present", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ reddoor: { lighthouseUrl: "http://localhost:5173/" } }),
    );
    expect(await readSiteConfig(dir)).toEqual({ lighthouseUrl: "http://localhost:5173/" });
  });

  // Guard against an operator clearing the field but leaving the key (`""`)
  // and expecting fallback — empty strings produce no useful URL.
  it("ignores empty-string lighthouseUrl (falls back to default)", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ reddoor: { lighthouseUrl: "" } }));
    expect(await readSiteConfig(dir)).toEqual({});
  });

  it("ignores non-string lighthouseUrl values", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ reddoor: { lighthouseUrl: 42 } }));
    expect(await readSiteConfig(dir)).toEqual({});
  });
});

// a11yRoutes (2026-08-01): the per-site opt-in that lets the a11y audit scan real
// routes instead of only the two synthetic fixtures. Absent key MUST behave exactly
// as before — 11 of the 12 fleet sites carry pre-existing a11y debt, so turning this
// on centrally would red every one of them at once.
describe("readSiteConfig — a11yRoutes", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "reddoor-site-config-a11y-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const write = (reddoor: unknown) =>
    writeFile(join(dir, "package.json"), JSON.stringify({ name: "site", reddoor }));

  it("reads a list of route paths", async () => {
    await write({ a11yRoutes: ["/", "/about", "/rsvp/euphorbia"] });
    expect(await readSiteConfig(dir)).toEqual({ a11yRoutes: ["/", "/about", "/rsvp/euphorbia"] });
  });

  it("omits the key entirely when it is absent", async () => {
    await write({ lighthouseUrl: "https://example.com" });
    expect(await readSiteConfig(dir)).toEqual({ lighthouseUrl: "https://example.com" });
  });

  it("ignores a non-array value", async () => {
    await write({ a11yRoutes: "/about" });
    expect(await readSiteConfig(dir)).toEqual({});
  });

  it("drops non-string and blank entries rather than passing them through", async () => {
    await write({ a11yRoutes: ["/about", "", "   ", 42, null, "/contact"] });
    expect(await readSiteConfig(dir)).toEqual({ a11yRoutes: ["/about", "/contact"] });
  });

  it("omits the key when every entry is junk (never an empty list)", async () => {
    await write({ a11yRoutes: ["", 7] });
    expect(await readSiteConfig(dir)).toEqual({});
  });

  it("trims surrounding whitespace", async () => {
    await write({ a11yRoutes: ["  /about  "] });
    expect(await readSiteConfig(dir)).toEqual({ a11yRoutes: ["/about"] });
  });

  it("coexists with lighthouseUrl", async () => {
    await write({ lighthouseUrl: "https://example.com", a11yRoutes: ["/"] });
    expect(await readSiteConfig(dir)).toEqual({
      lighthouseUrl: "https://example.com",
      a11yRoutes: ["/"],
    });
  });
});

// gateServer (#700): which server the browser gates run against. Both gates
// started `vite dev`, so nothing in CI ever opened the shipped bundle — and dev
// does not merely fail to reproduce some defects, it hides them (hydration,
// code splitting, and the CSP directive a stylesheet is fetched under all
// differ). Opt-in per site, because a preview costs a build per run and the
// `/dev/*` fixture routes the axe scan targets are not guaranteed to survive
// one. Anything but the two known values must read as `dev`: a typo that
// silently disabled the gate would be worse than one that changed nothing.
describe("readSiteConfig — gateServer", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "reddoor-site-config-gate-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const write = (reddoor: unknown) =>
    writeFile(join(dir, "package.json"), JSON.stringify({ name: "site", reddoor }));

  it("reads the preview opt-in", async () => {
    await write({ gateServer: "preview" });
    expect(await readSiteConfig(dir)).toEqual({ gateServer: "preview" });
  });

  it("reads an explicit dev declaration", async () => {
    await write({ gateServer: "dev" });
    expect(await readSiteConfig(dir)).toEqual({ gateServer: "dev" });
  });

  it("omits the key when absent (the default is decided by the caller)", async () => {
    await write({ a11yRoutes: ["/"] });
    expect(await readSiteConfig(dir)).toEqual({ a11yRoutes: ["/"] });
  });

  it("ignores an unrecognized value rather than passing it to a shell", async () => {
    // `"prod"` would otherwise reach `npm run prod` as a webServer command.
    await write({ gateServer: "prod" });
    expect(await readSiteConfig(dir)).toEqual({});
  });

  it("ignores a non-string value", async () => {
    await write({ gateServer: true });
    expect(await readSiteConfig(dir)).toEqual({});
  });

  it("coexists with the other keys", async () => {
    await write({ a11yRoutes: ["/"], gateServer: "preview" });
    expect(await readSiteConfig(dir)).toEqual({ a11yRoutes: ["/"], gateServer: "preview" });
  });
});

/**
 * readsPlaceholderPrismicRepo (#863). The fact the site side already reads in
 * four places, arriving in the audit: while a clone carries the starter's
 * `your-prismic-repo-name`, no Prismic repository stands behind it, so its own
 * content routes 404 by design.
 *
 * Every unclear answer must be `false`. A site buys 404 tolerance only on
 * positive evidence that it is unconfigured — the failure this returns to is
 * the one that reports too much (#680's red), never the one that reports
 * nothing.
 */
describe("readsPlaceholderPrismicRepo", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "reddoor-prismic-sentinel-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const write = (name: string, body: unknown) =>
    writeFile(join(dir, name), typeof body === "string" ? body : JSON.stringify(body));

  it("is false when the site has no Prismic config at all", async () => {
    expect(await readsPlaceholderPrismicRepo(dir)).toBe(false);
  });

  it("is true for the starter sentinel in slicemachine.config.json", async () => {
    await write("slicemachine.config.json", { repositoryName: PLACEHOLDER_PRISMIC_REPO });
    expect(await readsPlaceholderPrismicRepo(dir)).toBe(true);
  });

  it("is true for the sentinel in the CLI's renamed prismic.config.json", async () => {
    await write("prismic.config.json", { repositoryName: PLACEHOLDER_PRISMIC_REPO });
    expect(await readsPlaceholderPrismicRepo(dir)).toBe(true);
  });

  it("is false for a real Prismic repository", async () => {
    await write("slicemachine.config.json", { repositoryName: "caltex-industrial" });
    expect(await readsPlaceholderPrismicRepo(dir)).toBe(false);
  });

  // The one that would be expensive to get wrong. `reddoor-wireframer` is on
  // PLACEHOLDER_REPOSITORY_NAMES in src/prismic/models/config.ts because it
  // RESOLVES — data-dynamiq is served from it, with published documents. That
  // list means "mint no token"; this one means "a 404 here is expected", and
  // conflating them would buy a live site silent tolerance of a dead homepage.
  it("is false for reddoor-wireframer, which is a real repository data-dynamiq renders from", async () => {
    await write("slicemachine.config.json", { repositoryName: "reddoor-wireframer" });
    expect(await readsPlaceholderPrismicRepo(dir)).toBe(false);
  });

  // The CLI migration renames slicemachine.config.json to prismic.config.json,
  // so a half-migrated repo can hold a stale sentinel in the first file and its
  // real repository in the second. A real name anywhere wins.
  it("is false when a stale sentinel sits beside a real prismic.config.json", async () => {
    await write("slicemachine.config.json", { repositoryName: PLACEHOLDER_PRISMIC_REPO });
    await write("prismic.config.json", { repositoryName: "caltex-industrial" });
    expect(await readsPlaceholderPrismicRepo(dir)).toBe(false);
  });

  it("is true when every candidate file carries the sentinel", async () => {
    await write("slicemachine.config.json", { repositoryName: PLACEHOLDER_PRISMIC_REPO });
    await write("prismic.config.json", { repositoryName: PLACEHOLDER_PRISMIC_REPO });
    expect(await readsPlaceholderPrismicRepo(dir)).toBe(true);
  });

  it("trims, so a stray space in the config still reads as the sentinel", async () => {
    await write("slicemachine.config.json", { repositoryName: `  ${PLACEHOLDER_PRISMIC_REPO}  ` });
    expect(await readsPlaceholderPrismicRepo(dir)).toBe(true);
  });

  it("is false on malformed JSON rather than throwing", async () => {
    await write("slicemachine.config.json", "{ not valid json");
    await expect(readsPlaceholderPrismicRepo(dir)).resolves.toBe(false);
  });

  it("is false on a config that is valid JSON but not an object", async () => {
    await write("slicemachine.config.json", "null");
    expect(await readsPlaceholderPrismicRepo(dir)).toBe(false);
    await write("slicemachine.config.json", "[]");
    expect(await readsPlaceholderPrismicRepo(dir)).toBe(false);
  });

  it("is false when repositoryName is missing, empty or not a string", async () => {
    await write("slicemachine.config.json", { libraries: [] });
    expect(await readsPlaceholderPrismicRepo(dir)).toBe(false);
    await write("slicemachine.config.json", { repositoryName: "" });
    expect(await readsPlaceholderPrismicRepo(dir)).toBe(false);
    await write("slicemachine.config.json", { repositoryName: 42 });
    expect(await readsPlaceholderPrismicRepo(dir)).toBe(false);
  });

  // The audit reads the COMMITTED config, never VITE_PRISMIC_ENVIRONMENT. The
  // site side honours that override, but tests/smoke/routes.ts throws when it
  // names the sentinel under CI — "it would make this smoke run expect no home
  // page and pass" — and an audit that honoured it would hand that same false
  // green to any real site whose environment carried it.
  it("ignores VITE_PRISMIC_ENVIRONMENT", async () => {
    await write("slicemachine.config.json", { repositoryName: "caltex-industrial" });
    const before = process.env.VITE_PRISMIC_ENVIRONMENT;
    process.env.VITE_PRISMIC_ENVIRONMENT = PLACEHOLDER_PRISMIC_REPO;
    try {
      expect(await readsPlaceholderPrismicRepo(dir)).toBe(false);
    } finally {
      if (before === undefined) delete process.env.VITE_PRISMIC_ENVIRONMENT;
      else process.env.VITE_PRISMIC_ENVIRONMENT = before;
    }
  });
});
