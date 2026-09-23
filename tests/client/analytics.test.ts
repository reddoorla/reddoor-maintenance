import { describe, it, expect } from "vitest";
import { initAnalytics, gtagLoaderUrl, type AnalyticsEnv } from "../../src/client/analytics.js";

const PROD = "www.beachfrontdentistry.com";
const ID = "G-51J638HZPL";

type FakeScript = {
  async: boolean;
  src: string;
  attrs: Record<string, string>;
  setAttribute(name: string, value: string): void;
};

function newScript(): FakeScript {
  return {
    async: false,
    src: "",
    attrs: {},
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
  };
}

/**
 * A DOM just wide enough for this module, and deliberately NO wider: the
 * `querySelector` fake implements exactly `script[src*="…"]` and throws on
 * anything else, so a change to the module's selector surfaces as a loud test
 * failure instead of a fake that quietly answers the wrong question.
 */
function fakeDom(opts: { hostname: string; existingLoader?: string }) {
  const appended: FakeScript[] = [];
  const preexisting: FakeScript[] = [];
  if (opts.existingLoader) {
    preexisting.push({ ...newScript(), src: opts.existingLoader });
  }
  const win: { dataLayer?: unknown[]; gtag?: (...a: unknown[]) => void } = {};
  const env: AnalyticsEnv = {
    document: {
      createElement: () => newScript(),
      head: {
        appendChild(node) {
          appended.push(node as FakeScript);
        },
      },
      querySelectorAll(selectors: string) {
        // A real browser THROWS SyntaxError on a malformed attribute selector,
        // and the module used to build one by interpolating the measurement ID.
        // The fake reproduces that so the test can tell a contained failure
        // from a page-breaking one.
        const m = /^script\[src\*="([^"]*)"\]$/.exec(selectors);
        if (!m) {
          throw new SyntaxError(`'${selectors}' is not a valid selector`);
        }
        const needle = m[1] as string;
        return [...preexisting, ...appended].filter((s) => s.src.includes(needle));
      },
    },
    window: win,
    location: { hostname: opts.hostname },
  };
  return { env, appended, win };
}

describe("initAnalytics on the production host", () => {
  it("appends exactly one async loader for the measurement ID", () => {
    const { env, appended } = fakeDom({ hostname: PROD });
    expect(initAnalytics({ measurementId: ID, productionHost: PROD, env })).toBe("loaded");
    expect(appended).toHaveLength(1);
    expect(appended[0]?.src).toBe(gtagLoaderUrl(ID));
    expect(appended[0]?.src).toBe(`https://www.googletagmanager.com/gtag/js?id=${ID}`);
    expect(appended[0]?.async).toBe(true);
    expect(appended[0]?.attrs["data-reddoor-analytics"]).toBe(ID);
  });

  it("fires on the apex twin too, not just the configured spelling", () => {
    const { env, appended } = fakeDom({ hostname: "beachfrontdentistry.com" });
    expect(initAnalytics({ measurementId: ID, productionHost: PROD, env })).toBe("loaded");
    expect(appended).toHaveLength(1);
  });

  it("queues js and config, with config carrying the ID it was given", () => {
    const { env, win } = fakeDom({ hostname: PROD });
    initAnalytics({ measurementId: ID, productionHost: PROD, env });
    const layer = win.dataLayer as IArguments[];
    expect(layer).toHaveLength(2);
    expect(layer[0]?.[0]).toBe("js");
    expect(layer[0]?.[1]).toBeInstanceOf(Date);
    expect(layer[1]?.[0]).toBe("config");
    expect(layer[1]?.[1]).toBe(ID);
    expect(typeof win.gtag).toBe("function");
  });

  it("pushes the LIVE arguments object, never an array", () => {
    // gtag.js tells commands from data by type. Push an Array and the command
    // is read as data: the tag loads, reports nothing, and looks healthy. This
    // is the assertion that fails if someone "tidies" the shim into
    // `layer.push(args)` with a rest parameter.
    const { env, win } = fakeDom({ hostname: PROD });
    initAnalytics({ measurementId: ID, productionHost: PROD, env });
    for (const entry of win.dataLayer as unknown[]) {
      expect(Array.isArray(entry)).toBe(false);
      expect(Object.prototype.toString.call(entry)).toBe("[object Arguments]");
      expect((entry as IArguments).length).toBe(2);
    }
  });
});

describe("initAnalytics stays inert", () => {
  it("does nothing on any host that is not the site", () => {
    for (const hostname of [
      "localhost",
      "127.0.0.1",
      "beachfront-dentistry.netlify.app",
      "deploy-preview-12--beachfront-dentistry.netlify.app",
      "staging.beachfrontdentistry.com",
    ]) {
      const { env, appended, win } = fakeDom({ hostname });
      expect(initAnalytics({ measurementId: ID, productionHost: PROD, env })).toBe("off-host");
      expect(appended).toHaveLength(0);
      expect(win.dataLayer).toBeUndefined();
      expect(win.gtag).toBeUndefined();
    }
  });

  it("does nothing without a measurement ID — off is not broken", () => {
    for (const measurementId of [undefined, null, "", "   "]) {
      const { env, appended, win } = fakeDom({ hostname: PROD });
      expect(initAnalytics({ measurementId, productionHost: PROD, env })).toBe("no-id");
      expect(appended).toHaveLength(0);
      expect(win.dataLayer).toBeUndefined();
    }
  });

  it("does nothing with no DOM, so universal code can call it unguarded", () => {
    expect(
      initAnalytics({ measurementId: ID, productionHost: PROD, env: { document: undefined } }),
    ).toBe("no-dom");
  });

  it("honours a caller's gate, and ANDs it with the host check", () => {
    const { env, appended } = fakeDom({ hostname: PROD });
    expect(initAnalytics({ measurementId: ID, productionHost: PROD, gate: () => false, env })).toBe(
      "gated",
    );
    expect(appended).toHaveLength(0);

    // A gate that says yes cannot rescue a wrong host: the host check runs
    // first and a consent banner is not a licence to pollute the property.
    const off = fakeDom({ hostname: "localhost" });
    expect(
      initAnalytics({ measurementId: ID, productionHost: PROD, gate: () => true, env: off.env }),
    ).toBe("off-host");
    expect(off.appended).toHaveLength(0);
  });

  it("reports off-host ahead of gated when both are true", () => {
    // The precedence is part of the contract, not an accident of line order.
    // "off-host" is the more actionable diagnosis — it names a fact about the
    // deploy — and a caller's gate should never be asked to run, or be able to
    // throw, on a host the tag was never going to fire on anyway.
    const { env, appended } = fakeDom({ hostname: "localhost" });
    expect(initAnalytics({ measurementId: ID, productionHost: PROD, gate: () => false, env })).toBe(
      "off-host",
    );
    expect(appended).toHaveLength(0);
  });

  it("passes the real hostname to the gate", () => {
    const { env } = fakeDom({ hostname: "beachfrontdentistry.com" });
    let seen = "";
    initAnalytics({
      measurementId: ID,
      productionHost: PROD,
      gate: (ctx) => {
        seen = ctx.hostname;
        return true;
      },
      env,
    });
    expect(seen).toBe("beachfrontdentistry.com");
  });
});

describe("initAnalytics is idempotent", () => {
  it("appends one loader however many times it is called", () => {
    const { env, appended } = fakeDom({ hostname: PROD });
    expect(initAnalytics({ measurementId: ID, productionHost: PROD, env })).toBe("loaded");
    expect(initAnalytics({ measurementId: ID, productionHost: PROD, env })).toBe("already-loaded");
    expect(initAnalytics({ measurementId: ID, productionHost: PROD, env })).toBe("already-loaded");
    expect(appended).toHaveLength(1);
  });

  it("stands down only for its OWN id, never for a foreign loader", () => {
    // Double-counting is one property loaded twice, not two properties loaded
    // once. An id-blind guard stands down whenever any gtag loader is present,
    // which fails two ways that both read as success: a GTM container injects
    // /gtag/js at runtime and would silence us entirely, and a legacy snippet
    // with the WRONG id would suppress the right one while reporting
    // "already-loaded". Installing alongside is the safe direction — both
    // properties then count correctly, and the audit warns about the second
    // loader so it is visible rather than silent.
    const foreign = fakeDom({
      hostname: PROD,
      existingLoader: "https://www.googletagmanager.com/gtag/js?id=G-OLDOLDOLD",
    });
    expect(initAnalytics({ measurementId: ID, productionHost: PROD, env: foreign.env })).toBe(
      "loaded",
    );
    expect(foreign.appended).toHaveLength(1);

    const same = fakeDom({
      hostname: PROD,
      existingLoader: `https://www.googletagmanager.com/gtag/js?id=${ID}`,
    });
    expect(initAnalytics({ measurementId: ID, productionHost: PROD, env: same.env })).toBe(
      "already-loaded",
    );
    expect(same.appended).toHaveLength(0);
  });

  it("reads window.dataLayer live, so a replaced array does not orphan the queue", () => {
    // gtag.js and any tag manager may REPLACE the array rather than mutate it.
    // A captured reference would leave our commands queued on something nobody
    // drains, and the tag would look installed while reporting nothing.
    const { env, win } = fakeDom({ hostname: PROD });
    initAnalytics({ measurementId: ID, productionHost: PROD, env });
    const replacement: unknown[] = [];
    win.dataLayer = replacement;
    win.gtag!("event", "after_replacement");
    expect(replacement).toHaveLength(1);
  });

  it("is NOT fooled by a GTM container, which is a different product", () => {
    // gallerysonder runs GTM behind a consent banner and is deliberately out
    // of scope. A selector matching the bare host would silently no-op there.
    const { env, appended } = fakeDom({
      hostname: PROD,
      existingLoader: "https://www.googletagmanager.com/gtm.js?id=GTM-5FVCTMK7",
    });
    expect(initAnalytics({ measurementId: ID, productionHost: PROD, env })).toBe("loaded");
    expect(appended).toHaveLength(1);
  });
});

describe("gtagLoaderUrl", () => {
  it("encodes the ID, so a malformed config cannot smuggle query parameters", () => {
    expect(gtagLoaderUrl("G-ABC&foo=bar")).toBe(
      "https://www.googletagmanager.com/gtag/js?id=G-ABC%26foo%3Dbar",
    );
  });
});

describe("initAnalytics survives an ID it was never meant to get", () => {
  // `MEASUREMENT_ID_RE` guards the recipe's path, but initAnalytics is public
  // API a site calls directly — and the recipe's own template calls it from
  // hooks.client.ts's `init`, i.e. during client boot. A throw there takes the
  // page down for an analytics misconfiguration.
  it("does not throw on an ID that would break a CSS selector", () => {
    for (const measurementId of ['G-X"]', "G-A[B]", "G-A\\B"]) {
      const { env } = fakeDom({ hostname: PROD });
      expect(() => initAnalytics({ measurementId, productionHost: PROD, env })).not.toThrow();
    }
  });

  it("stays idempotent for an ID that needs percent-encoding", () => {
    // The loader `src` is encoded; a raw-ID selector could never match it, so
    // every re-run appended another loader — the exact double-counting the
    // ID-aware check exists to prevent.
    // `'` is the one character encodeURIComponent leaves raw that the URL
    // parser's special-query set escapes, so a string comparison against the
    // written src failed and every re-run appended another loader — the
    // double-counting this guard exists to prevent, surviving inside it.
    for (const measurementId of ["G-A B", "G-Ä1234567", "G-A%20B", "G-tick'q", "G-amp&x"]) {
      const { env, appended } = fakeDom({ hostname: PROD });
      expect(initAnalytics({ measurementId, productionHost: PROD, env })).toBe("loaded");
      expect(initAnalytics({ measurementId, productionHost: PROD, env })).toBe("already-loaded");
      expect(appended).toHaveLength(1);
    }
  });
});
