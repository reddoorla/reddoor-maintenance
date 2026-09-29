import { describe, it, expect } from "vitest";
import { planCspEdit } from "../../src/recipes/analytics-tag/csp-edit.js";
import { ANALYTICS_CSP } from "../../src/configs/svelte.js";
import {
  hooksClientTemplate,
  MEASUREMENT_ID_RE,
} from "../../src/recipes/analytics-tag/template.js";

describe("planCspEdit", () => {
  it("refuses SvelteKit's OWN kit.csp, which is what 13 of 28 fleet configs have", () => {
    // THE defect round four found, and the reason every positive fixture here
    // used to be a lie: `analytics` is a createSvelteConfig option. SvelteKit
    // types kit.csp as {mode, directives, reportOnly} and REJECTS unknown keys,
    // so writing it into a native block does not fail to work — it fails the
    // build. Measured: the old matcher fired on 13 native blocks where the
    // option is invalid and zero of the 12 factory callers where it would have
    // worked. Both starter templates were in the 13.
    const native = `export default {
  kit: {
    adapter: adapter(),
    csp: { mode: "auto", directives: { "script-src": ["self"] } },
  },
};`;
    const out = planCspEdit(native);
    expect(out.kind).toBe("refuse");
    if (out.kind === "refuse") {
      expect(out.reason).toContain("SvelteKit's own");
      expect(out.handAdd).toContain("script-src https://www.googletagmanager.com");
    }
  });

  it("turns the shorthand into the object form", () => {
    const out = planCspEdit("export default createSvelteConfig({ csp: true });");
    expect(out.kind).toBe("edit");
    if (out.kind === "edit") {
      expect(out.next).toBe("export default createSvelteConfig({ csp: { analytics: true } });");
    }
  });

  it("refuses a csp nested in kit even when the file also calls the factory", () => {
    const mixed = `export default createSvelteConfig({
  kit: { csp: { mode: "auto" } },
});`;
    expect(planCspEdit(mixed).kind).toBe("refuse");
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
    expect(MEASUREMENT_ID_RE.test("G-51J638HZPLX")).toBe(false);
    expect(MEASUREMENT_ID_RE.test("g-51j638hzpl")).toBe(false);
  });
});

describe("planCspEdit, round six", () => {
  it("puts the full host list on every refusal, derived from ANALYTICS_CSP", () => {
    const expected = Object.entries(ANALYTICS_CSP)
      .map(([d, hosts]) => `${d} ${hosts.join(" ")}`)
      .join("; ");
    for (const src of [
      'export default { kit: { csp: { mode: "auto" } } };',
      "const A = /x/;\nexport default { kit: { csp: true } };",
      "export default createSvelteConfig({ csp: SHARED });",
      'const kit = { csp: { mode: "auto" } };\nexport default { kit };',
    ]) {
      const out = planCspEdit(src);
      expect(out.kind).toBe("refuse");
      if (out.kind === "refuse") expect(out.handAdd).toBe(expected);
    }
  });

  it("says 'none' for a file that never mentions csp, even with a regex in it", () => {
    // roalson-interests' shape minus its CSP: a regex literal used to refuse
    // first, and the note then said the browser refuses the loader on a site
    // with no CSP at all.
    expect(
      planCspEdit("const re = /^\\/properties\\/([^/]+)$/;\nexport default { kit: {} };").kind,
    ).toBe("none");
  });

  it("calls a CSP it could not locate 'possible', and one it located 'present'", () => {
    const regex = planCspEdit(
      "const re = /a/;\nexport default { kit: { csp: { mode: 'auto' } } };",
    );
    expect(regex.kind === "refuse" && regex.policy).toBe("possible");
    const native = planCspEdit('export default { kit: { csp: { mode: "auto" } } };');
    expect(native.kind === "refuse" && native.policy).toBe("present");
  });

  it("refuses a kit object held in a variable, which a negative test used to edit", () => {
    // The old factory check was "not under a `kit:` key". `const kit = {…}`
    // is not a `kit:` key, so this was edited into a build failure.
    const src = `const kitOptions = { adapter: adapter(), csp: { mode: "auto", directives: {} } };
export default createSvelteConfig({ kit: kitOptions });`;
    expect(planCspEdit(src).kind).toBe("refuse");
  });

  it("refuses a shorthand or quoted csp key rather than calling the file CSP-free", () => {
    expect(planCspEdit("const csp = x;\nexport default { kit: { csp } };").kind).toBe("refuse");
    expect(planCspEdit('export default { kit: { "csp": { mode: "auto" } } };').kind).toBe("refuse");
  });
});
