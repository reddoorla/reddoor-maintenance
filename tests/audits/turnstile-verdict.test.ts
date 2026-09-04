import { describe, it, expect } from "vitest";
import { turnstileVerdict, type TurnstileObservation } from "../../src/audits/form-e2e.js";

/** The two browser-independent states, and the one that is neither. */
const RENDERED_OK: TurnstileObservation = { rendered: true, hostnameRejected: false };
const REJECTED: TurnstileObservation = { rendered: false, hostnameRejected: true };
const NO_WIDGET: TurnstileObservation = { rendered: false, hostnameRejected: false };

describe("turnstileVerdict", () => {
  it("no sitekey deployed is a conclusive fail, with or without a browser", () => {
    // /health is sound in THIS direction only: an empty env var cannot mint a
    // token. It stays a fail for a site the probe never opened a browser for,
    // which is how the 7 testMode-undeclared sites keep the honest verdict that
    // function-health used to give them.
    expect(turnstileVerdict({ testMode: false, turnstile: false }, undefined)).toBe("fail");
    expect(turnstileVerdict({ testMode: true, turnstile: false }, RENDERED_OK)).toBe("fail");
  });

  it("110200 on the live hostname is a fail — the failure that loses every lead", () => {
    expect(turnstileVerdict({ testMode: true, turnstile: true }, REJECTED)).toBe("fail");
  });

  it("the real widget rendered on the real hostname without 110200 earns the pass", () => {
    expect(turnstileVerdict({ testMode: true, turnstile: true }, RENDERED_OK)).toBe("pass");
  });

  it("a key with nothing to look at it is UNVERIFIED, never a pass (#689)", () => {
    // The regression the whole issue was about: a sitekey belonging to a widget
    // full at Cloudflare's 10-hostname cap sets the env var and mints nothing.
    // Absent a browser observation there is no evidence, so there is no verdict.
    expect(turnstileVerdict({ testMode: true, turnstile: true }, undefined)).toBeNull();
    expect(turnstileVerdict({ testMode: true, turnstile: null }, undefined)).toBeNull();
  });

  it("a key set but no widget container on the page is unverified, not a fail", () => {
    // The probe may have landed on a form the widget is not mounted on. That is
    // not evidence the widget is broken, so it must not manufacture a red alarm.
    expect(turnstileVerdict({ testMode: true, turnstile: true }, NO_WIDGET)).toBeNull();
  });

  it("never returns pass from /health alone — only a browser can earn it", () => {
    // Guards the exact inversion #689 was filed for. Every /health-only input,
    // across the whole domain of the flag, must be fail or null.
    for (const turnstile of [true, false, null] as const) {
      expect(turnstileVerdict({ testMode: true, turnstile }, undefined)).not.toBe("pass");
    }
  });
});
