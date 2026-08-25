import { describe, it, expect } from "vitest";
import { DETAIL_VALUE_FN, renderSiteDashboardHtml } from "../../src/dashboard/render.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

/**
 * The dashboard's inline script is a template string, so nothing in this suite
 * has ever executed it — `vitest.config.ts` runs `environment: "node"`, there is
 * no DOM, and the render tests only assert on markup. That gap is exactly how
 * the bug this file fixes shipped: #591 added a checkbox and a multi-select to
 * the site editor, both rendered correctly, and neither could actually save.
 *
 *   - `HTMLInputElement.value` on a checkbox is the `value` CONTENT ATTRIBUTE
 *     (defaulting to "on") — never the checked state. The old `saveDetail` sent
 *     `el.value`, so `Require Turnstile` posted "on", which the `bool` kind
 *     rightly refuses. Worse, its listener was the text-input one, guarded by
 *     `value !== defaultValue` — both "on" — so it never fired at all.
 *   - `HTMLSelectElement.value` on a `multiple` select is the first selected
 *     option only. `Accepted Watch Conditions` would have silently saved one
 *     condition and dropped the rest.
 *
 * So the serializer is now a named function, EXPORTED as source and executed
 * here against element stubs. This runs the string the page actually serves —
 * the same discipline as extracting a workflow's gate script and running it,
 * rather than asserting on a copy.
 */

type Stub = Record<string, unknown>;

/** Evaluate the ACTUAL served source and hand back the function it defines. */
function loadDetailValue(): (el: Stub) => string {
  return new Function(`${DETAIL_VALUE_FN}\nreturn detailValue;`)() as (el: Stub) => string;
}

describe("detailValue — the served serializer, executed", () => {
  const detailValue = loadDetailValue();

  it("sends a checkbox's CHECKED STATE, not its value attribute", () => {
    // Faithful stubs: a checkbox's `.value` really is "on" whether or not it is
    // checked, which is the whole trap.
    expect(detailValue({ type: "checkbox", checked: true, value: "on" })).toBe("true");
    expect(detailValue({ type: "checkbox", checked: false, value: "on" })).toBe("false");
  });

  it("sends EVERY selected option of a multi-select, not just the first", () => {
    const el = {
      multiple: true,
      value: "Performance", // what HTMLSelectElement.value would give: the first
      selectedOptions: [{ value: "Performance" }, { value: "SEO" }],
    };
    expect(detailValue(el)).toBe("Performance,SEO");
  });

  it("sends an empty string when a multi-select has nothing selected", () => {
    // The `multiselect` kind maps "" to [], which is how the field is cleared.
    expect(detailValue({ multiple: true, value: "", selectedOptions: [] })).toBe("");
  });

  it("leaves every other control on plain .value", () => {
    expect(detailValue({ type: "text", value: "acme" })).toBe("acme");
    expect(detailValue({ type: "password", value: "secret" })).toBe("secret");
    expect(detailValue({ value: "some text" })).toBe("some text");
    // A SINGLE select is not a multi-select: `.value` is already correct there,
    // and treating it as one would depend on selectedOptions it may not stub.
    expect(detailValue({ multiple: false, value: "maintained" })).toBe("maintained");
  });
});

describe("the editor binds a listener that can actually fire", () => {
  const html = renderSiteDashboardHtml(makeWebsiteRow({ name: "Acme" }), []);

  it("binds checkboxes on CHANGE, not on the blur+defaultValue path", () => {
    // The blur handler only saves when `value !== defaultValue`; for a checkbox
    // both are "on", so binding it there means it never saves. This asserts the
    // checkbox has its own change binding.
    expect(html).toMatch(/input\[type=checkbox\]\[data-detail-field\][^)]*\)/);
    expect(html).toContain('addEventListener("change"');
  });

  it("excludes checkboxes from the blur/defaultValue binding", () => {
    // Belt and braces: if a checkbox stayed in the blur selector too, a save
    // could fire twice — and the second would race the first.
    expect(html).toContain("input:not([type=checkbox])[data-detail-field]");
  });
});
