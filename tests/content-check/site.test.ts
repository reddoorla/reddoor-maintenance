// P1-120 phase 2: the instrument's three proofs, then the site-level rules
// (exemptions, cross-file fallbacks, the baseline).
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ContentCheckConfigError,
  newFindings,
  readBaseline,
  readConfig,
  resolveImport,
  scanSite,
  staleCount,
  toBaseline,
} from "../../src/content-check/check.js";
import { KINDS } from "../../src/content-check/rules.js";

const FIXTURES = resolve(import.meta.dirname, "../fixtures/content-check");
const scan = async (dir: string) => scanSite(dir, readConfig(dir));

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});
function site(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "content-check-"));
  temps.push(dir);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  return dir;
}

describe("proof 1: a known-clean page passes", () => {
  it("reports nothing: its visible text all comes from Prismic, with code fallbacks", async () => {
    const r = await scan(join(FIXTURES, "clean"));
    expect(r.findings).toEqual([]);
    expect(r.unparsed).toEqual([]);
    // The page, its server load, the hero, the copy module and two helpers:
    // the clean result is about files that were read, not files that were missed.
    expect(r.files).toBe(6);
  });

  it("exempts its legal page and its /dev route, which do hold literals", async () => {
    const r = await scan(join(FIXTURES, "clean"));
    expect(r.exempt).toEqual([
      { file: "src/routes/dev/+page.svelte", why: "dev route" },
      { file: "src/routes/privacy/+page.svelte", why: "legal page" },
    ]);
  });
});

describe("proof 2: a known-dirty page warns on every kind", () => {
  it("reports at least one literal of each of the census's kinds", async () => {
    const r = await scan(join(FIXTURES, "dirty"));
    const kinds = new Set(r.findings.map((f) => f.kind));
    expect([...KINDS].filter((k) => !kinds.has(k))).toEqual([]);
  });

  it("reports these rows, at these lines", async () => {
    const r = await scan(join(FIXTURES, "dirty"));
    expect(r.findings.map((f) => `${f.line} ${f.kind} ${f.text}`)).toEqual([
      "3 image hero.jpg",
      "6 copy Jane Doe",
      "6 team Jane has built homes in the valley for twenty years.",
      "7 testimonial They built our dream home.",
      "7 testimonial Sam and Alex",
      "11 seo Fixture Co. | Custom homes",
      "12 seo Custom homes in the valley since 1998.",
      "15 heading Homes built to last",
      "16 copy We build homes that last for generations.",
      "17 button Book a visit",
      "18 alt A finished kitchen",
      "19 image /images/porch.webp",
      "20 video 1092190178",
      "20 video /video/poster.jpg",
      "21 link /contact",
      "21 copy Contact us",
      "22 phone tel:+15550100199",
      "22 phone (555) 010-0199",
      "23 email mailto:hello@example.com",
      "23 email hello@example.com",
      "24 address 1234 Main Street, Suite 5",
      "25 hours Mon–Fri, 8am to 5pm",
      "33 social https://www.instagram.com/fixtureco/",
      "33 copy Follow along",
    ]);
  });
});

describe("proof 3: Vineyard's gallery hero, the census's own proof", () => {
  const hero = <T extends { text: string }>(rows: T[]): T[] =>
    rows.filter((f) => f.text === "homethumb.jpg" || f.text === "1092190178");

  it("flags the hero image and video ID on the commit before PR #159 (be56f67)", async () => {
    const r = await scan(join(FIXTURES, "vineyard/before"));
    expect(hero(r.findings).map((f) => [f.line, f.kind, f.text])).toEqual([
      [3, "image", "homethumb.jpg"],
      [46, "video", "1092190178"],
    ]);
  });

  it("does not flag them on main (8e6c939), where they are fallbacks for the hero fields", async () => {
    const r = await scan(join(FIXTURES, "vineyard/after"));
    expect(hero(r.findings)).toEqual([]);
  });

  it("reports the rows the fix did not touch the same on both", async () => {
    const before = await scan(join(FIXTURES, "vineyard/before"));
    const after = await scan(join(FIXTURES, "vineyard/after"));
    const rest = (rows: typeof before.findings) =>
      rows.filter((f) => hero([f]).length === 0).map((f) => [f.kind, f.text]);
    expect(rest(after.findings)).toEqual(rest(before.findings));
    expect(rest(after.findings)).toEqual([
      ["image", "vch-mark-lightsvg.svg"],
      ["alt", "vch logomark"],
    ]);
  });
});

describe("exemptions", () => {
  it("exempts legal routes under groups and parameters, and /dev only at the top", async () => {
    const dir = site({
      "src/routes/[[preview=preview]]/(legal)/terms-of-service/+page.svelte": "<p>Legal words.</p>",
      "src/routes/accessibility/+page.svelte": "<p>Legal words.</p>",
      "src/lib/components/PrivacyPolicy.svelte": "<p>Legal words.</p>",
      "src/routes/dev/slices/+page.svelte": "<p>Dev words.</p>",
      "src/routes/about/dev/+page.svelte": "<p>Visitor words.</p>",
      "src/routes/developers/+page.svelte": "<p>Visitor words.</p>",
      "src/routes/legal/cookies/+page.svelte": "<p>Legal words.</p>",
      "src/routes/services/accessibility/+page.svelte": "<p>Visitor words.</p>",
      "src/routes/recipes/cookies/+page.svelte": "<p>Visitor words.</p>",
      "src/lib/components/Disclaimer.svelte": "<p>Visitor words.</p>",
    });
    const r = await scan(dir);
    expect(r.findings.map((f) => f.file)).toEqual([
      "src/lib/components/Disclaimer.svelte",
      "src/routes/about/dev/+page.svelte",
      "src/routes/developers/+page.svelte",
      "src/routes/recipes/cookies/+page.svelte",
      "src/routes/services/accessibility/+page.svelte",
    ]);
    expect(r.exempt.map((e) => e.why).sort()).toEqual([
      "dev route",
      "legal page",
      "legal page",
      "legal page",
      "legal page",
    ]);
  });

  it("exempts the globs in content-check.json", async () => {
    const dir = site({
      "content-check.json": JSON.stringify({ exempt: ["src/routes/sandbox/**"] }),
      "src/routes/sandbox/+page.svelte": "<p>Sandbox words.</p>",
      "src/routes/+page.svelte": "<p>Visitor words.</p>",
    });
    const r = await scan(dir);
    expect(r.findings.map((f) => f.file)).toEqual(["src/routes/+page.svelte"]);
    expect(r.exempt).toEqual([
      { file: "src/routes/sandbox/+page.svelte", why: "content-check.json" },
    ]);
  });

  it("skips tests, type declarations and +server endpoints", async () => {
    const dir = site({
      "src/lib/a.test.ts": `export const t = { title: "Not content" };`,
      "src/lib/a.d.ts": `export declare const t: { title: "Not content" };`,
      "src/routes/sitemap.xml/+server.ts": `export const GET = () => new Response("<urlset/>", { headers: { title: "Not content" } });`,
      "src/lib/report/fixtures/all-pass.ts": `export const r = { title: "Not content" };`,
      "src/lib/home-fixture.ts": `export const h = { title: "Not content" };`,
      "src/lib/team.fixture.ts": `export const t = { title: "Not content" };`,
    });
    expect((await scan(dir)).files).toBe(0);
  });
});

describe("fallbacks across files (MSOT's copy modules, P1-103)", () => {
  const helper = `export function text(value: string | null | undefined, fallback: string) { return value || fallback; }`;

  it("an exported copy object read only as a fallback, here and by its importers, is not reported", async () => {
    const dir = site({
      "src/lib/content.ts": helper,
      "src/lib/copy/home.ts": `import { text } from "../content";
export const HOME_COPY = { heading: "Homes built to last" };
export const homeCopy = (d) => ({ heading: text(d?.heading, HOME_COPY.heading) });`,
      "src/routes/+page.server.ts": `import { dev } from "$app/environment";
import { HOME_COPY, homeCopy } from "$lib/copy/home";
export const load = () => homeCopy(dev ? HOME_COPY : null);`,
    });
    expect((await scan(dir)).findings).toEqual([]);
  });

  it("is reported once any scanned file reads it plainly", async () => {
    const dir = site({
      "src/lib/content.ts": helper,
      "src/lib/copy/home.ts": `import { text } from "../content";
export const HOME_COPY = { heading: "Homes built to last" };
export const homeCopy = (d) => ({ heading: text(d?.heading, HOME_COPY.heading) });`,
      "src/routes/+page.svelte": `<script>import { HOME_COPY } from "$lib/copy/home.js";</script><h1>{HOME_COPY.heading}</h1>`,
    });
    expect((await scan(dir)).findings.map((f) => [f.file, f.kind, f.text])).toEqual([
      ["src/lib/copy/home.ts", "heading", "Homes built to last"],
    ]);
  });

  it("a namespace import cannot be followed, so it counts as a plain read", async () => {
    const dir = site({
      "src/lib/copy.ts": `export const COPY = { heading: "Homes built to last" };`,
      "src/routes/+page.svelte": `<script>import * as copy from "$lib/copy";</script><h1>{copy.COPY.heading}</h1>`,
    });
    expect((await scan(dir)).findings).toHaveLength(1);
  });

  it("follows a barrel's re-exports one hop (round 1)", async () => {
    const files = (page: string) => ({
      "src/lib/site.ts": `export const SITE = { title: "Acme Winery" };`,
      "src/lib/index.ts": `export { SITE } from "./site";\nexport * from "./more";`,
      "src/lib/more.ts": `export const MORE = { title: "Taste the coast" };`,
      "src/routes/+page.svelte": page,
    });
    const fallbackOnly = site(
      files(
        `<script>import { SITE, MORE } from "$lib";</script><h1>{doc.title || SITE.title}</h1><h2>{doc.sub || MORE.title}</h2>`,
      ),
    );
    expect((await scan(fallbackOnly)).findings).toEqual([]);
    const plain = site(
      files(
        `<script>import { SITE, MORE } from "$lib"; const t = doc.t || SITE.title;</script><h1>{SITE.title}</h1><h2>{MORE.title}</h2>`,
      ),
    );
    expect((await scan(plain)).findings.map((f) => f.text)).toEqual([
      "Taste the coast",
      "Acme Winery",
    ]);
  });

  it("finds a fallback parameter through a barrel (round 1)", async () => {
    const dir = site({
      "src/lib/content.ts": `export function text(value, fallback) { return value || fallback; }`,
      "src/lib/index.ts": `export { text } from "./content";`,
      "src/routes/+page.svelte": `<script>import { text } from "$lib";</script><h1>{text(doc.title, "Welcome home")}</h1>`,
    });
    expect((await scan(dir)).findings).toEqual([]);
  });

  it("a prop default is a fallback only when every call site passes the prop (round 2)", async () => {
    const band = `<script>let { label = "Request Appointment", tone = "light" } = $props();</script><p>{label}</p>`;
    const old = `<script>export let heading = "Welcome home";</script><h1>{heading}</h1>`;
    const always = site({
      "src/lib/CtaBand.svelte": band,
      "src/lib/Old.svelte": old,
      "src/routes/a/+page.svelte": `<script>import CtaBand from "$lib/CtaBand.svelte"; import Old from "$lib/Old.svelte";</script><CtaBand label={doc.cta} /><Old heading={doc.h} />`,
      "src/routes/b/+page.svelte": `<script>import Band from "$lib/CtaBand.svelte"; import Old from "$lib/Old.svelte";</script><Band {...rest} /><Old bind:heading={h} />`,
    });
    expect((await scan(always)).findings).toEqual([]);
    const sometimes = site({
      "src/lib/CtaBand.svelte": band,
      "src/lib/Old.svelte": old,
      "src/routes/a/+page.svelte": `<script>import CtaBand from "$lib/CtaBand.svelte"; import Old from "$lib/Old.svelte";</script><CtaBand label={doc.cta} /><Old heading={doc.h} />`,
      "src/routes/b/+page.svelte": `<script>import CtaBand from "$lib/CtaBand.svelte";</script><CtaBand />`,
    });
    expect((await scan(sometimes)).findings.map((f) => [f.file, f.text])).toEqual([
      ["src/lib/CtaBand.svelte", "Request Appointment"],
    ]);
    const never = site({ "src/lib/Old.svelte": old });
    expect((await scan(never)).findings.map((f) => f.text)).toEqual(["Welcome home"]);
  });

  it("resolves ./, ../ and $lib/ specifiers, with or without an extension", () => {
    const known = new Set(["src/lib/a.ts", "src/lib/b/index.ts", "src/lib/C.svelte"]);
    expect(resolveImport("src/routes/x.ts", "$lib/a", known)).toBe("src/lib/a.ts");
    expect(resolveImport("src/routes/x.ts", "$lib/a.js", known)).toBe("src/lib/a.ts");
    expect(resolveImport("src/lib/z/y.ts", "../b", known)).toBe("src/lib/b/index.ts");
    expect(resolveImport("src/lib/y.ts", "./C", known)).toBe("src/lib/C.svelte");
    expect(resolveImport("src/lib/y.ts", "@prismicio/client", known)).toBeUndefined();
  });
});

describe("the baseline", () => {
  const f = (file: string, line: number, text: string) => ({
    file,
    line,
    kind: "copy" as const,
    text,
  });

  it("counts by file, kind and text, never by line", () => {
    const base = toBaseline([f("a", 1, "Hi there"), f("a", 9, "Hi there"), f("b", 1, "Hi there")]);
    expect(base).toEqual({
      version: 1,
      counts: { a: { "copy\tHi there": 2 }, b: { "copy\tHi there": 1 } },
    });
    // The same literals on other lines: nothing new.
    expect(newFindings([f("a", 40, "Hi there"), f("a", 41, "Hi there")], base)).toEqual([]);
  });

  it("reports only what is beyond the baseline's count, the later copies first", () => {
    const base = toBaseline([f("a", 1, "Hi there")]);
    expect(
      newFindings([f("a", 1, "Hi there"), f("a", 7, "Hi there"), f("a", 3, "New words")], base),
    ).toEqual([f("a", 3, "New words"), f("a", 7, "Hi there")]);
  });

  it("counts what the code no longer has, for phase 3 to shrink", () => {
    const base = toBaseline([f("a", 1, "Hi there"), f("a", 2, "Gone now"), f("b", 1, "Gone too")]);
    expect(staleCount([f("a", 1, "Hi there")], base)).toBe(2);
  });

  it("refuses a malformed baseline rather than read it as empty or full", () => {
    for (const body of [
      "not json",
      `{"version": 2, "counts": {}}`,
      `{"version": 1, "counts": {"a": {"copy\\tx": 0}}}`,
      `{"version": 1}`,
      `{"version": 1, "counts": []}`,
      `null`,
      `[]`,
      `{"version": 1, "counts": {"a": []}}`,
    ]) {
      const dir = site({ "content-check.baseline.json": body });
      expect(() => readBaseline(dir)).toThrow(ContentCheckConfigError);
    }
  });
});

describe("settings", () => {
  it("defaults to warn with nothing exempt", () => {
    expect(readConfig(site({}))).toEqual({
      mode: "warn",
      exempt: [],
      ignore: [],
      fallbackHelpers: [],
    });
  });

  it("refuses an ignore entry that is not a valid regex, or has a flag other than imsu (round 1)", () => {
    for (const entry of ["/[a-/", "/x/q", "/x/d"]) {
      const dir = site({ "content-check.json": JSON.stringify({ ignore: [entry] }) });
      expect(() => readConfig(dir), entry).toThrow(ContentCheckConfigError);
    }
    const ok = site({ "content-check.json": JSON.stringify({ ignore: ["/acme/gi", "[a-"] }) });
    expect(readConfig(ok).ignore).toEqual(["/acme/gi", "[a-"]);
  });

  it("refuses an unknown key, a bad mode or a non-list", () => {
    for (const body of [
      `{"mdoe": "fail"}`,
      `{"mode": "error"}`,
      `{"exempt": "src/**"}`,
      `[]`,
      `{`,
    ]) {
      expect(() => readConfig(site({ "content-check.json": body }))).toThrow(
        ContentCheckConfigError,
      );
    }
  });
});

describe("the fixtures are what the tests say they are", () => {
  it("vineyard/before and /after are the real files, byte for byte by their heads", () => {
    const before = readFileSync(
      join(FIXTURES, "vineyard/before/src/routes/[[preview=preview]]/gallery/+page.svelte"),
      "utf8",
    );
    const after = readFileSync(
      join(FIXTURES, "vineyard/after/src/routes/[[preview=preview]]/gallery/+page.svelte"),
      "utf8",
    );
    expect(before).toContain(`<ScreenWidthMedia darken vimeoId="1092190178" src={vchVideoThumb}>`);
    expect(after).toContain(`vimeoId={vimeoIdOr(content.hero_vimeo_id, "1092190178")}`);
    expect(after).toContain(`field={content.hero_image}`);
  });

  it("copying a fixture keeps its result (the tests read them in place)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "content-check-copy-"));
    temps.push(dir);
    cpSync(join(FIXTURES, "dirty"), dir, { recursive: true });
    expect((await scan(dir)).findings).toHaveLength(24);
  });
});
