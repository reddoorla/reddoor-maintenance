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
  const CF = (code: string) => `TurnstileError: [Cloudflare Turnstile] Error: ${code}.`;

  it("catches a dead sitekey in BOTH families Cloudflare files them under", () => {
    // The table is not tidy by prefix: "invalid sitekey" is 110100 AND 400020, and
    // "sitekey disabled" is 400070 with no 110xxx twin. Matching the 110 prefix
    // alone left the disabled-widget case scoring "pass" — the same hole one family
    // along, which is how this arm came to exist in the first place.
    for (const code of ["110100", "110110", "400020", "400070"])
      expect(TURNSTILE_WIDGET_ERROR.test(CF(code))).toBe(true);
  });

  it("takes the rest of 110xxx by prefix, so a future code fails SAFE", () => {
    // Includes 110420 (invalid action) and the two retryable timeouts 110600 /
    // 110620, which are challenge-time rather than lookup-time. Deliberate: this
    // arm only ever denies a green, so over-matching costs one empty cell for a
    // night, while under-matching costs leads.
    for (const code of ["110420", "110600", "110620", "110999"])
      expect(TURNSTILE_WIDGET_ERROR.test(CF(code))).toBe(true);
  });

  it("leaves 110200 to the fail arm that owns it", () => {
    // If it also set widgetError the fail arm would still win — it is checked
    // first — but the two must not overlap, or the verdict table lies.
    expect(TURNSTILE_WIDGET_ERROR.test(CF("110200"))).toBe(false);
    expect(TURNSTILE_HOSTNAME_REJECTED.test(CF("110200"))).toBe(true);
  });

  it("does NOT match 600010 — that is the harness's own signature", () => {
    // The one load-bearing exclusion. Cloudflare answers EVERY CDP-driven browser
    // with 600010, so a matcher that caught it would set widgetError on every
    // nightly run and make "pass" unreachable — the audit would go inert with
    // nothing to show for it.
    expect(TURNSTILE_WIDGET_ERROR.test(CF("600010"))).toBe(false);
    expect(TURNSTILE_HOSTNAME_REJECTED.test(CF("600010"))).toBe(false);
  });

  it("stops at the two named 4000xx codes — not the whole family", () => {
    // 3xxxxx and the rest of 4xxxxx are network and challenge conditions, not
    // statements about the sitekey, and a probe's own environment produces them.
    for (const code of ["400010", "400100", "300030", "200100"])
      expect(TURNSTILE_WIDGET_ERROR.test(CF(code))).toBe(false);
  });

  it("is anchored on Cloudflare's prefix, so a page printing the digits is not a signal", () => {
    expect(TURNSTILE_WIDGET_ERROR.test("order 110100 shipped")).toBe(false);
    expect(TURNSTILE_WIDGET_ERROR.test("invoice 400070 paid")).toBe(false);
    // ...and it cannot be tricked by a longer number that merely contains one.
    expect(TURNSTILE_WIDGET_ERROR.test(CF("1101000"))).toBe(false);
  });
});
