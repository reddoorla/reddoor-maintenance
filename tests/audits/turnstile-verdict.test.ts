import { describe, it, expect } from "vitest";
import {
  turnstileVerdict,
  TURNSTILE_WIDGET_ERROR,
  TURNSTILE_HOSTNAME_REJECTED,
  type TurnstileObservation,
} from "../../src/audits/form-e2e.js";

/** A live, healthy widget: the mount point AND Cloudflare's script. */
const LIVE: TurnstileObservation = {
  containerPresent: true,
  scriptLoaded: true,
  hostnameRejected: false,
  initFailed: false,
  widgetError: false,
};
const ob = (over: Partial<TurnstileObservation>): TurnstileObservation => ({ ...LIVE, ...over });

describe("turnstileVerdict", () => {
  it("no sitekey deployed is a conclusive fail, with or without a browser", () => {
    // /health is sound in THIS direction only: an empty env var cannot mint a
    // token. It stays a fail for a site the probe never opened a browser for.
    expect(turnstileVerdict({ testMode: false, turnstile: false }, undefined)).toBe("fail");
    expect(turnstileVerdict({ testMode: true, turnstile: false }, LIVE)).toBe("fail");
  });

  it("110200 on the live hostname is a fail — the failure that loses every lead", () => {
    expect(
      turnstileVerdict({ testMode: true, turnstile: true }, ob({ hostnameRejected: true })),
    ).toBe("fail");
  });

  it("the mount point AND Cloudflare's script together earn the pass", () => {
    expect(turnstileVerdict({ testMode: true, turnstile: true }, LIVE)).toBe("pass");
  });

  describe("the pass arm needs POSITIVE evidence, not the absence of an error", () => {
    // The regression the first draft of this change shipped, and the reason it
    // matters: the starter server-renders `<div class="cf-turnstile">` from
    // `{#if turnstileSiteKey}`, so the container is present whenever the env var
    // is set — including when api.js never loads (a hand-edited CSP, a 5xx, a
    // runner with blocked egress). The widget then mints NO token while the DOM
    // looks perfectly healthy. Accepting the container alone reintroduces exactly
    // the false "pass" that #689 was filed for.
    it("refuses a pass when Cloudflare's script never loaded", () => {
      expect(
        turnstileVerdict({ testMode: true, turnstile: true }, ob({ scriptLoaded: false })),
      ).toBeNull();
    });

    it("refuses a pass when the page reported the widget could not render", () => {
      expect(
        turnstileVerdict({ testMode: true, turnstile: true }, ob({ initFailed: true })),
      ).toBeNull();
    });

    it("refuses a pass when there is no mount point at all", () => {
      expect(
        turnstileVerdict({ testMode: true, turnstile: true }, ob({ containerPresent: false })),
      ).toBeNull();
    });

    it("refuses a pass when Cloudflare rejected the sitekey itself", () => {
      // A widget DELETED or rotated at Cloudflare — the operation this fleet
      // performs routinely ("Forms 1 is full", three widgets and counting). api.js
      // still answers 2xx (its URL carries no sitekey) and the starter still SSRs
      // the mount point, so every positive signal is true and the only tell is a
      // 110100/110110. Without this arm that shape scored "pass": the first
      // draft's defect surviving one error code along.
      expect(
        turnstileVerdict({ testMode: true, turnstile: true }, ob({ widgetError: true })),
      ).toBeNull();
    });

    it("a container with nothing behind it is UNVERIFIED, never a fail", () => {
      // Not a fail: a probe whose own egress is blocked looks identical to a site
      // whose script 5xx'd. A red alarm manufactured by our own network is worse
      // than no alarm, so every non-110200 defect degrades to "unverified".
      for (const broken of [{ scriptLoaded: false }, { initFailed: true }, { widgetError: true }]) {
        expect(turnstileVerdict({ testMode: true, turnstile: true }, ob(broken))).not.toBe("fail");
      }
    });
  });

  it("a key with nothing to look at it is UNVERIFIED, never a pass (#689)", () => {
    expect(turnstileVerdict({ testMode: true, turnstile: true }, undefined)).toBeNull();
    expect(turnstileVerdict({ testMode: true, turnstile: null }, undefined)).toBeNull();
  });

  it("never returns pass from /health alone — only a browser can earn it", () => {
    for (const turnstile of [true, false, null] as const) {
      expect(turnstileVerdict({ testMode: true, turnstile }, undefined)).not.toBe("pass");
    }
  });

  it("only ONE observation shape yields a pass, out of every combination", () => {
    // Exhaustive over all five booleans: the pass arm must be exactly
    // {container, script, !rejected, !initFailed, !widgetError}. A future edit
    // that widens it by one field fails here rather than in production, which is
    // how BOTH of this change's false-pass holes would have been caught.
    let passes = 0;
    for (const containerPresent of [true, false])
      for (const scriptLoaded of [true, false])
        for (const hostnameRejected of [true, false])
          for (const initFailed of [true, false])
            for (const widgetError of [true, false]) {
              const shape = {
                containerPresent,
                scriptLoaded,
                hostnameRejected,
                initFailed,
                widgetError,
              };
              if (turnstileVerdict({ testMode: true, turnstile: true }, shape) === "pass") {
                passes++;
                expect(shape).toEqual(LIVE);
              }
            }
    expect(passes).toBe(1);
  });
});

describe("TURNSTILE_WIDGET_ERROR", () => {
  // The two codes measured verbatim in this fleet, and the reason the families are
  // split: 110xxx is a sitekey/domain lookup, decided before any challenge runs and
  // identical for a human; 6xxxxx is challenge execution, which Cloudflare fails for
  // every driven browser whatever the configuration.
  const CF = (code: string) => `TurnstileError: [Cloudflare Turnstile] Error: ${code}.`;

  it("matches the sitekey rejections, and NOT the hostname one 110200 already owns", () => {
    for (const code of ["110100", "110110", "110420", "110600"])
      expect(TURNSTILE_WIDGET_ERROR.test(CF(code))).toBe(true);
    // 110200 is a FAIL via its own matcher; if it also set widgetError the fail arm
    // would still win, but the two must not overlap or the verdict table lies.
    expect(TURNSTILE_WIDGET_ERROR.test(CF("110200"))).toBe(false);
    expect(TURNSTILE_HOSTNAME_REJECTED.test(CF("110200"))).toBe(true);
  });

  it("does NOT match 600010 — that is the harness's own signature", () => {
    // Load-bearing: Cloudflare answers EVERY CDP-driven browser with 600010, so a
    // matcher that caught it would set widgetError on every nightly run and make
    // "pass" unreachable — the audit would go inert with nothing to show for it.
    expect(TURNSTILE_WIDGET_ERROR.test(CF("600010"))).toBe(false);
    expect(TURNSTILE_HOSTNAME_REJECTED.test(CF("600010"))).toBe(false);
  });

  it("is anchored on Cloudflare's prefix, so a page printing the digits is not a signal", () => {
    expect(TURNSTILE_WIDGET_ERROR.test("order 110100 shipped")).toBe(false);
    expect(TURNSTILE_WIDGET_ERROR.test("call 110100 for support")).toBe(false);
  });
});
