import { describe, it, expect } from "vitest";
import {
  DETAIL_VALUE_FN,
  SAVE_DETAIL_FN,
  renderSiteDashboardHtml,
} from "../../src/dashboard/render.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import { WATCH_CONDITION_OPTIONS } from "../../src/dashboard/site-details.js";

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

  it("no selectable option contains the separator it is joined on", () => {
    // The wire format for a multi-select is comma-joined here and split on
    // `/[,\n]/` server-side. That round-trips only while no option value contains
    // a comma or a newline — true today, and asserted nowhere until now, so an
    // innocuous new option like "Deploy failed, retried" would silently arrive as
    // two conditions with no error anywhere.
    for (const opt of WATCH_CONDITION_OPTIONS) {
      expect(opt, `watch condition "${opt}" would split into two on the wire`).not.toMatch(/[,\n]/);
    }
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

/** Evaluate the ACTUAL served saveDetail source, with fetch injected. */
function loadSaveDetail(fetchImpl: (url: string, init: unknown) => Promise<{ ok: boolean }>) {
  return new Function("fetch", `${DETAIL_VALUE_FN}\n${SAVE_DETAIL_FN}\nreturn saveDetail;`)(
    fetchImpl,
  ) as (el: Stub, root: { querySelector: (s: string) => Stub | null }) => Promise<void>;
}

const NO_SPAN = { querySelector: () => null };

describe("saveDetail — the served save, executed", () => {
  function textInput(over: Stub = {}): Stub {
    return {
      value: "new",
      defaultValue: "old",
      dataset: { detailField: "name", detailsUrl: "/x" },
      ...over,
    };
  }

  it("resyncs defaultValue after a successful save, so the next blur is a no-op", async () => {
    // Without this the blur guard (`value !== defaultValue`) stays true forever and
    // every later focus+blur re-POSTs the field until the page is reloaded.
    const el = textInput();
    await loadSaveDetail(() => Promise.resolve({ ok: true }))(el, NO_SPAN);
    expect(el.defaultValue).toBe("new");
    expect(el.defaultValue).toBe(el.value);
  });

  it("leaves defaultValue DIRTY when the save fails, so the next blur retries", async () => {
    // The positive control for the test above: if resync were unconditional this
    // would also read "new", and a failed write would look saved.
    const el = textInput();
    await loadSaveDetail(() => Promise.resolve({ ok: false }))(el, NO_SPAN);
    expect(el.defaultValue).toBe("old");
  });

  it("leaves defaultValue dirty when the request rejects outright", async () => {
    const el = textInput();
    await loadSaveDetail(() => Promise.reject(new Error("offline")))(el, NO_SPAN);
    expect(el.defaultValue).toBe("old");
  });

  it("the secret row's empty defaultValue is resynced too — the credential re-POST case", async () => {
    // The `secret` kind deliberately emits no `value` attribute so an existing
    // credential is never echoed into the HTML, which pins defaultValue at "".
    // That made it the worst instance: every blur after typing re-sent the secret.
    const el = textInput({ value: "sk_live_xyz", defaultValue: "" });
    await loadSaveDetail(() => Promise.resolve({ ok: true }))(el, NO_SPAN);
    expect(el.defaultValue).toBe("sk_live_xyz");
  });

  it("does not choke on a select, which has no defaultValue at all", async () => {
    const el = {
      multiple: true,
      value: "a",
      selectedOptions: [{ value: "a" }],
      dataset: { detailField: "acceptedWatchConditions", detailsUrl: "/x" },
    };
    await loadSaveDetail(() => Promise.resolve({ ok: true }))(el, NO_SPAN);
    expect("defaultValue" in el).toBe(false);
  });

  it("posts the field name and the serialized value", async () => {
    let body: unknown = null;
    const el = textInput();
    await loadSaveDetail((_u, init) => {
      body = JSON.parse((init as { body: string }).body);
      return Promise.resolve({ ok: true });
    })(el, NO_SPAN);
    expect(body).toEqual({ field: "name", value: "new" });
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
