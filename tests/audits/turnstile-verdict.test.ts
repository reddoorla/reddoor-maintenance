import { describe, it, expect } from "vitest";
import { turnstileVerdict, type TurnstileObservation } from "../../src/audits/form-e2e.js";

/** A live, healthy widget: the mount point AND Cloudflare's script. */
const LIVE: TurnstileObservation = {
  containerPresent: true,
  scriptLoaded: true,
  hostnameRejected: false,
  initFailed: false,
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

    it("a container with nothing behind it is UNVERIFIED, never a fail", () => {
      // Not a fail: a probe whose own egress is blocked looks identical to a site
      // whose script 5xx'd. A red alarm manufactured by our own network is worse
      // than no alarm, so every non-110200 defect degrades to "unverified".
      for (const broken of [{ scriptLoaded: false }, { initFailed: true }]) {
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
    // Exhaustive over the four booleans: the pass arm must be exactly
    // {container, script, !rejected, !initFailed}. A future edit that widens it
    // by one field fails here rather than in production, which is how the first
    // draft's hole would have been caught.
    let passes = 0;
    for (const containerPresent of [true, false])
      for (const scriptLoaded of [true, false])
        for (const hostnameRejected of [true, false])
          for (const initFailed of [true, false]) {
            const v = turnstileVerdict(
              { testMode: true, turnstile: true },
              { containerPresent, scriptLoaded, hostnameRejected, initFailed },
            );
            if (v === "pass") {
              passes++;
              expect({ containerPresent, scriptLoaded, hostnameRejected, initFailed }).toEqual(
                LIVE,
              );
            }
          }
    expect(passes).toBe(1);
  });
});
