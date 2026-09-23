import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { planCspEdit } from "../../src/recipes/analytics-tag/csp-edit.js";
import {
  hooksClientTemplate,
  MEASUREMENT_ID_RE,
} from "../../src/recipes/analytics-tag/template.js";

describe("planCspEdit", () => {
  it("turns the shorthand into the object form", () => {
    const out = planCspEdit("export default createSvelteConfig({ csp: true });");
    expect(out.kind).toBe("edit");
    if (out.kind === "edit") {
      expect(out.next).toBe("export default createSvelteConfig({ csp: { analytics: true } });");
    }
  });

  it("inserts into an existing object without touching its directives", () => {
    const src = `export default createSvelteConfig({
  csp: {
    mode: "auto",
    directives: { "script-src": ["self"] },
  },
});`;
    const out = planCspEdit(src);
    expect(out.kind).toBe("edit");
    if (out.kind === "edit") {
      expect(out.next).toContain("{ analytics: true,");
      expect(out.next).toContain('"script-src": ["self"]');
    }
  });

  it("is idempotent — a second pass changes nothing", () => {
    const once = planCspEdit("export default createSvelteConfig({ csp: true });");
    expect(once.kind).toBe("edit");
    if (once.kind !== "edit") return;
    expect(planCspEdit(once.next).kind).toBe("already");
  });

  it("says nothing to do when the site has no CSP", () => {
    expect(planCspEdit("export default { kit: { adapter: adapter() } };").kind).toBe("none");
  });

  it("is not fooled by `csp:` inside a comment or a string", () => {
    // These files are heavily commented — reddoor-starter's csp block is ~50
    // lines of prose around a dozen values — and a comment mentioning the
    // option must not be mistaken for a second one.
    const src = `// the csp: option is documented at ...
const note = "csp: true";
export default createSvelteConfig({ csp: true });`;
    const out = planCspEdit(src);
    expect(out.kind).toBe("edit");
  });

  it("refuses rather than guessing when the shape is unfamiliar", () => {
    // A half-rewritten CSP lands on the live site, on every request. Refusing
    // and reporting is strictly better than a clever guess.
    for (const src of [
      "export default createSvelteConfig({ csp: SHARED_CSP });",
      "export default createSvelteConfig({ csp: buildCsp() });",
    ]) {
      const out = planCspEdit(src);
      expect(out.kind).toBe("refuse");
    }
  });

  it("refuses when two csp keys make the target ambiguous", () => {
    const out = planCspEdit(
      `const a = { csp: true };\nexport default createSvelteConfig({ csp: true });`,
    );
    expect(out.kind).toBe("refuse");
    if (out.kind === "refuse") expect(out.reason).toContain("ambiguous");
  });

  it("refuses a regex literal rather than guessing at quote parity", () => {
    // A quote inside a regex opens a phantom string and inverts parity for the
    // rest of the file. The confirmed outcome was an edit that landed INSIDE a
    // comment, parsed cleanly, left the real CSP untouched, and was reported as
    // "analytics hosts enabled" — a wrong edit announced as success, which is
    // the one thing this module exists to prevent.
    const inverting = `const A = /'/;
export default { kit: { csp: { directives: {} } } };
// note ' about csp: { } here`;
    const out = planCspEdit(inverting);
    expect(out.kind).toBe("refuse");

    // And the commoner variant, which used to fail to a FALSE "none" — worse,
    // because the recipe then reports "this site has no csp option".
    const falseNone = `const APOS = /'/g;
export default { kit: { csp: { directives: { "script-src": ["self"] } } } };`;
    expect(planCspEdit(falseNone).kind).toBe("refuse");
  });

  it("refuses division too, rather than trying to tell it from a regex", () => {
    const out = planCspEdit(`const half = total / 2;
export default { kit: { csp: true } };`);
    expect(out.kind).toBe("refuse");
    if (out.kind === "refuse") expect(out.reason).toContain("cannot classify");
  });

  it("refuses an analytics key already set to something else", () => {
    const out = planCspEdit("export default createSvelteConfig({ csp: { analytics: flag } });");
    expect(out.kind).toBe("refuse");
  });

  it("scopes the already-done check to the csp block's own braces", () => {
    // An unrelated `analytics: true` elsewhere in the file must not make the
    // recipe think it has already run.
    const src = `export default createSvelteConfig({
  somethingElse: { analytics: true },
  csp: { mode: "auto" },
});`;
    const out = planCspEdit(src);
    expect(out.kind).toBe("edit");
  });

  it("skips braces inside strings, comments and template literals", () => {
    // Every one of these files has all three.
    const src = `export default createSvelteConfig({
  csp: {
    // a brace in a comment: }
    note: "a brace in a string: }",
    tpl: \`a brace in a template: }\`,
    mode: "auto",
  },
});`;
    const out = planCspEdit(src);
    expect(out.kind).toBe("edit");
    if (out.kind === "edit") expect(planCspEdit(out.next).kind).toBe("already");
  });
});

describe("the client hook it writes", () => {
  it("quotes both values, so a stray quote cannot break the file", () => {
    const out = hooksClientTemplate({
      measurementId: 'G-AAA"BBB',
      productionHost: 'ex"ample.com',
    });
    expect(out).toContain('"G-AAA\\"BBB"');
    expect(out).toContain('"ex\\"ample.com"');
  });

  it("uses SvelteKit's init export, not a bare side effect", () => {
    const out = hooksClientTemplate({ measurementId: "G-AAAAAAAAAA", productionHost: "x.com" });
    expect(out).toContain("export const init: ClientInit");
    expect(out).toContain('from "@reddoorla/maintenance/client"');
  });
});

describe("MEASUREMENT_ID_RE", () => {
  it("accepts a real web-stream ID and refuses the numeric property ID", () => {
    // The two get confused constantly and fail in opposite directions: a wrong
    // measurement ID collects into nothing and looks fine.
    expect(MEASUREMENT_ID_RE.test("G-51J638HZPL")).toBe(true);
    expect(MEASUREMENT_ID_RE.test("551435715")).toBe(false);
    expect(MEASUREMENT_ID_RE.test("UA-12345-1")).toBe(false);
    expect(MEASUREMENT_ID_RE.test("G-TOOSHORT")).toBe(false);
    expect(MEASUREMENT_ID_RE.test("g-51j638hzpl")).toBe(false);
  });
});

describe("cspNote tells you what it checked, not what is true", () => {
  it("does not claim nothing blocks the loader when it only read svelte.config.js", async () => {
    // reddoor-website and gallerysonder set an enforcing Content-Security-Policy
    // in netlify.toml and have no `csp:` in svelte.config.js at all. The old
    // wording asserted "nothing blocks the loader" about sites where a header
    // can refuse it on every request — the one thing this half exists to report.
    const { analyticsTag } = await import("../../src/recipes/analytics-tag/index.js");
    expect(typeof analyticsTag).toBe("function");
    const src = await readFile(
      new URL("../../src/recipes/analytics-tag/index.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toContain("so nothing blocks the loader");
    expect(src).toContain("was NOT checked");
  });

  it("refuses to install alongside a loader the site already has", async () => {
    // initAnalytics stands down only for its OWN id, and a site-local loader
    // that runs later never sees ours. beachfront's component appends in
    // onMount with no guard, so migrating it with its existing id would give
    // one property two loaders and double every session.
    const src = await readFile(
      new URL("../../src/recipes/analytics-tag/index.ts", import.meta.url),
      "utf8",
    );
    expect(src).toContain("findForeignAnalytics");
    expect(src).toContain("double every session");
  });
});
