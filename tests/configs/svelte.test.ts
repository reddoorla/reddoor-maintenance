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
});
