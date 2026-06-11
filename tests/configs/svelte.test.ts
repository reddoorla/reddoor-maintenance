import { describe, it, expect } from "vitest";
import createSvelteConfig, { createSvelteConfig as named } from "../../src/configs/svelte.js";

describe("configs/svelte", () => {
  it("default export equals the named export", () => {
    expect(createSvelteConfig).toBe(named);
  });

  it("returns a config that preserves site-specific fields (kit.adapter, preprocess)", () => {
    const adapter = () => ({ name: "fake-adapter" });
    const preprocess = { name: "fake-preprocess" };
    const config = createSvelteConfig({ kit: { adapter }, preprocess });
    // kit now also carries the canonical alias defaults (covered separately);
    // here we only assert the site's own adapter survives.
    expect(config.kit).toMatchObject({ adapter });
    expect(config.preprocess).toBe(preprocess);
  });

  it("injects a warningFilter that silences element_invalid_self_closing_tag", () => {
    const config = createSvelteConfig({});
    const filter = config.compilerOptions?.warningFilter;
    expect(filter).toBeTypeOf("function");
    expect(filter?.({ code: "element_invalid_self_closing_tag" })).toBe(false);
  });

  it("lets all other warnings through by default", () => {
    const config = createSvelteConfig({});
    const filter = config.compilerOptions?.warningFilter;
    expect(filter?.({ code: "state_referenced_locally" })).toBe(true);
    expect(filter?.({ code: "some_other_code" })).toBe(true);
    expect(filter?.({})).toBe(true);
  });

  it("composes with a site-provided warningFilter (both must allow for a warning to show)", () => {
    const config = createSvelteConfig({
      compilerOptions: {
        // Site filter silences a11y_no_static_element_interactions.
        warningFilter: (w) => w.code !== "a11y_no_static_element_interactions",
      },
    });
    const filter = config.compilerOptions?.warningFilter;

    // Ours silences self-closing
    expect(filter?.({ code: "element_invalid_self_closing_tag" })).toBe(false);
    // Site filter silences a11y rule
    expect(filter?.({ code: "a11y_no_static_element_interactions" })).toBe(false);
    // Unrelated warnings pass through both filters
    expect(filter?.({ code: "state_referenced_locally" })).toBe(true);
  });

  it("preserves other compilerOptions the site passes", () => {
    const config = createSvelteConfig({
      compilerOptions: { runes: true, customElement: false },
    });
    expect(config.compilerOptions?.runes).toBe(true);
    expect(config.compilerOptions?.customElement).toBe(false);
  });

  it("injects the canonical reddoor kit.alias entries by default", () => {
    const config = createSvelteConfig({});
    const alias = (config.kit as { alias?: Record<string, string> })?.alias;
    expect(alias).toMatchObject({
      $components: "src/lib/components",
      "$components/*": "src/lib/components/*",
      $utils: "src/lib/utils",
      "$utils/*": "src/lib/utils/*",
      $stores: "src/lib/stores",
      "$stores/*": "src/lib/stores/*",
      $assets: "src/lib/assets",
      "$assets/*": "src/lib/assets/*",
    });
  });

  it("merges a site-provided kit.alias over the canonical defaults (site wins per key, extras kept)", () => {
    const config = createSvelteConfig({
      kit: {
        alias: {
          $components: "src/lib/ui", // override a canonical entry
          $features: "src/lib/features", // a site-only extra
        },
      },
    });
    const alias = (config.kit as { alias?: Record<string, string> })?.alias ?? {};
    expect(alias.$components).toBe("src/lib/ui"); // site wins
    expect(alias.$features).toBe("src/lib/features"); // extra preserved
    expect(alias.$utils).toBe("src/lib/utils"); // canonical default still present
  });

  it("preserves other kit fields (adapter, prerender) while injecting alias", () => {
    const adapter = () => ({ name: "fake-adapter" });
    const prerender = { handleHttpError: () => undefined };
    const config = createSvelteConfig({ kit: { adapter, prerender } });
    const kit = config.kit as {
      adapter?: unknown;
      prerender?: unknown;
      alias?: Record<string, string>;
    };
    expect(kit.adapter).toBe(adapter);
    expect(kit.prerender).toBe(prerender);
    expect(kit.alias?.$assets).toBe("src/lib/assets");
  });

  // --- opt-in CSP -------------------------------------------------------
  type Kit = {
    csp?: { mode?: string; directives?: Record<string, string[]>; [k: string]: unknown };
    prerender?: { handleHttpError?: (d: unknown) => void; [k: string]: unknown };
  };

  it("does not inject kit.csp by default (never silently forces a policy)", () => {
    const config = createSvelteConfig({});
    expect((config.kit as Kit).csp).toBeUndefined();
  });

  it("csp:true injects the baseline Prismic+Vimeo CSP (mode auto, report-uri)", () => {
    const config = createSvelteConfig({ csp: true });
    const csp = (config.kit as Kit).csp!;
    expect(csp.mode).toBe("auto");
    expect(csp.directives?.["default-src"]).toEqual(["self"]);
    expect(csp.directives?.["script-src"]).toEqual([
      "self",
      "https://static.cdn.prismic.io",
      "https://player.vimeo.com",
    ]);
    expect(csp.directives?.["report-uri"]).toEqual(["/api/csp-report"]);
  });

  it("returns directive arrays decoupled from the shared baseline (mutating one config never poisons the next)", () => {
    const a = createSvelteConfig({ csp: true });
    (a.kit as Kit).csp!.directives!["script-src"]!.push("https://evil.example");
    const b = createSvelteConfig({ csp: true });
    expect((b.kit as Kit).csp!.directives!["script-src"]).toEqual([
      "self",
      "https://static.cdn.prismic.io",
      "https://player.vimeo.com",
    ]);
  });

  it("csp:{directives} extends the baseline — overrides the named directive, keeps the rest", () => {
    const config = createSvelteConfig({
      csp: { directives: { "script-src": ["self", "https://plausible.io"] } },
    });
    const csp = (config.kit as Kit).csp!;
    // overridden directive
    expect(csp.directives?.["script-src"]).toEqual(["self", "https://plausible.io"]);
    // untouched baseline directive still present
    expect(csp.directives?.["img-src"]).toEqual([
      "self",
      "data:",
      "https://images.prismic.io",
      "https://*.prismic.io",
    ]);
  });

  it("csp:{mode,...} flows non-directive fields through over the baseline", () => {
    const config = createSvelteConfig({
      csp: { mode: "hash", directives: { "connect-src": ["self", "https://api.example"] } },
    });
    const csp = (config.kit as Kit).csp!;
    expect(csp.mode).toBe("hash"); // mode override flows through ...rest
    expect(csp.directives?.["connect-src"]).toEqual(["self", "https://api.example"]); // extended
    expect(csp.directives?.["default-src"]).toEqual(["self"]); // untouched baseline kept
  });

  it("an explicit kit.csp wins over the csp option (escape hatch)", () => {
    const config = createSvelteConfig({ csp: true, kit: { csp: { mode: "hash" } } });
    expect((config.kit as Kit).csp?.mode).toBe("hash");
  });

  it("the csp option never leaks onto the returned config as a top-level field", () => {
    const config = createSvelteConfig({ csp: true });
    expect((config as Record<string, unknown>).csp).toBeUndefined();
  });

  // --- opt-in prerender placeholder tolerance ---------------------------
  it("does not inject prerender.handleHttpError by default", () => {
    const config = createSvelteConfig({});
    expect((config.kit as Kit).prerender).toBeUndefined();
  });

  it("placeholder:true injects a handleHttpError that tolerates 404 but throws other statuses", () => {
    const config = createSvelteConfig({ placeholder: true });
    const handle = (config.kit as Kit).prerender?.handleHttpError;
    expect(handle).toBeTypeOf("function");
    expect(handle!({ status: 404, path: "/blog/x" })).toBeUndefined();
    expect(() => handle!({ status: 500, path: "/y", message: "boom" })).toThrow(/500 \/y.*boom/);
    // a missing status must throw too — only a real 404 is tolerated
    expect(() => handle!({ path: "/z", message: "no status" })).toThrow();
  });

  it("placeholder handler folds the referrer into the thrown message when present", () => {
    const config = createSvelteConfig({ placeholder: true });
    const handle = (config.kit as Kit).prerender?.handleHttpError;
    expect(() => handle!({ status: 500, path: "/y", message: "boom", referrer: "/from" })).toThrow(
      /500 \/y \(linked from \/from\): boom/,
    );
  });

  it("placeholder:true preserves a site-provided prerender field and lets its handleHttpError win", () => {
    const siteHandle = () => undefined;
    const config = createSvelteConfig({
      placeholder: true,
      kit: { prerender: { handleHttpError: siteHandle, entries: ["*"] } },
    });
    const prerender = (config.kit as Kit).prerender!;
    expect(prerender.entries).toEqual(["*"]);
    expect(prerender.handleHttpError).toBe(siteHandle);
  });

  it("the placeholder option never leaks onto the returned config as a top-level field", () => {
    const config = createSvelteConfig({ placeholder: true });
    expect((config as Record<string, unknown>).placeholder).toBeUndefined();
  });
});
