import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  defaultShooter,
  consentHideRule,
  CONSENT_SELECTOR,
  CONSENT_BUTTON_NAME,
  type ShootOptions,
} from "../../../src/reports/header-image/capture.js";

/** Every call the fake page saw, in order, so assertions read off real calls
 *  rather than a re-implementation of the navigation. */
type Call = { name: string; args: unknown[] };

const calls: Call[] = [];
let closed = false;
/** Set per-test to make the best-effort idle wait reject, the way a site with a
 *  chat widget or analytics polling makes it reject in production. */
let idleRejects = false;
/** Set per-test to make the best-effort consent click reject, the way a site
 *  with no banner makes it reject in production (no button → click times out). */
let consentClickRejects = false;

const SHOT = new Uint8Array([137, 80, 78, 71]);

function record(name: string, ...args: unknown[]): void {
  calls.push({ name, args });
}

function calledWith(name: string): Call | undefined {
  return calls.find((c) => c.name === name);
}

vi.mock("@playwright/test", () => {
  const page = {
    goto: async (...args: unknown[]) => {
      record("goto", ...args);
    },
    waitForLoadState: async (...args: unknown[]) => {
      record("waitForLoadState", ...args);
      if (idleRejects) throw new Error("page.waitForLoadState: Timeout 3000ms exceeded.");
    },
    evaluate: async (...args: unknown[]) => {
      record("evaluate", ...args);
    },
    waitForTimeout: async (...args: unknown[]) => {
      record("waitForTimeout", ...args);
    },
    screenshot: async (...args: unknown[]) => {
      record("screenshot", ...args);
      return SHOT;
    },
    addStyleTag: async (...args: unknown[]) => {
      record("addStyleTag", ...args);
    },
    getByRole: (...args: unknown[]) => {
      record("getByRole", ...args);
      return {
        first: () => ({
          click: async (...clickArgs: unknown[]) => {
            record("click", ...clickArgs);
            if (consentClickRejects) {
              throw new Error("locator.click: Timeout 1500ms exceeded.");
            }
          },
        }),
      };
    },
  };
  return {
    chromium: {
      launch: async () => ({
        newPage: async (...args: unknown[]) => {
          record("newPage", ...args);
          return page;
        },
        close: async () => {
          closed = true;
          record("close");
        },
      }),
    },
  };
});

async function shoot(extra: Partial<ShootOptions> = {}): Promise<Uint8Array> {
  const s = await defaultShooter();
  return s.shoot({
    url: "https://acme.com/",
    width: 1600,
    height: 1000,
    deviceScaleFactor: 2,
    settleMs: 2500,
    ...extra,
  });
}

const order = (name: string) => calls.findIndex((c) => c.name === name);

describe("reports/header-image defaultShooter navigation", () => {
  beforeEach(() => {
    calls.length = 0;
    closed = false;
    idleRejects = false;
    consentClickRejects = false;
  });

  it("navigates on the load milestone, never on networkidle", async () => {
    await shoot();
    const goto = calledWith("goto");
    expect(goto?.args[0]).toBe("https://acme.com/");
    expect(goto?.args[1]).toMatchObject({ waitUntil: "load" });
    // Regression guard: 4 of 14 live fleet sites never reach network idle, so
    // gating the navigation on it made them permanently uncapturable.
    expect(goto?.args[1]).not.toMatchObject({ waitUntil: "networkidle" });
  });

  it("still attempts network idle on a short budget after load", async () => {
    await shoot();
    const idle = calledWith("waitForLoadState");
    expect(idle?.args[0]).toBe("networkidle");
    expect(idle?.args[1]).toMatchObject({ timeout: 3000 });
    expect(calls.map((c) => c.name).indexOf("waitForLoadState")).toBeGreaterThan(
      calls.map((c) => c.name).indexOf("goto"),
    );
  });

  it("captures the screenshot even when the idle wait times out", async () => {
    idleRejects = true;
    const bytes = await shoot();
    // Assert the reject path was actually taken, so this can't pass vacuously
    // against an implementation that skips the idle wait altogether.
    expect(calledWith("waitForLoadState")).toBeDefined();
    expect(bytes).toEqual(SHOT);
    expect(calledWith("screenshot")).toBeDefined();
    // The font and settle waits still run — swallowing the idle timeout must not
    // skip what actually covers webfonts and entrance animations.
    expect(calledWith("evaluate")).toBeDefined();
    expect(calledWith("waitForTimeout")?.args[0]).toBe(2500);
  });

  it("closes the browser on the idle-timeout path", async () => {
    idleRejects = true;
    await shoot();
    expect(calledWith("waitForLoadState")).toBeDefined();
    expect(closed).toBe(true);
  });
});

// #654: Sonder's header shipped the cookie banner and its scrim over the hero —
// "the least sexy version of the site". Settle time was irrelevant (the banner
// never leaves on its own); dismissing it was the whole fix. The handling lives
// here because `refreshHeaderImage` regenerates with no options, so nothing a
// CLI flag carries would ever reach the automated path.
describe("reports/header-image defaultShooter consent handling (#654)", () => {
  beforeEach(() => {
    calls.length = 0;
    closed = false;
    idleRejects = false;
    consentClickRejects = false;
  });

  it("hides cookie/consent elements with a style tag before the shutter", async () => {
    await shoot();
    const style = calls.find(
      (c) =>
        c.name === "addStyleTag" &&
        String((c.args[0] as { content?: string })?.content).includes("cookie"),
    );
    expect(style).toBeDefined();
    expect((style!.args[0] as { content: string }).content).toBe(consentHideRule());
    expect(order("addStyleTag")).toBeGreaterThan(order("evaluate"));
    expect(order("addStyleTag")).toBeLessThan(order("screenshot"));
  });

  it("tries an accept/reject button first, on a short swallowed timeout, so the site unwinds its own scrim", async () => {
    await shoot();
    const role = calledWith("getByRole");
    expect(role?.args[0]).toBe("button");
    expect((role?.args[1] as { name: RegExp }).name).toBe(CONSENT_BUTTON_NAME);
    const click = calledWith("click");
    expect((click?.args[0] as { timeout: number }).timeout).toBeLessThanOrEqual(2000);
    // The click comes before the style tag: once the rule hides the button it is
    // no longer actionable, and the click would time out on every site.
    expect(order("click")).toBeLessThan(order("addStyleTag"));
    // And before the settle wait, so the settle absorbs the dismissal animation.
    expect(order("click")).toBeLessThan(order("waitForTimeout"));
  });

  it("is a no-op where there is nothing to dismiss: a failed click still hides, settles and shoots", async () => {
    consentClickRejects = true;
    const bytes = await shoot();
    expect(calledWith("click")).toBeDefined();
    expect(bytes).toEqual(SHOT);
    expect(calledWith("addStyleTag")).toBeDefined();
    expect(calledWith("waitForTimeout")?.args[0]).toBe(2500);
    expect(calledWith("screenshot")).toBeDefined();
    expect(closed).toBe(true);
  });

  it("appends a per-site consentSelector to the hide rule for banners the heuristic misses", async () => {
    await shoot({ consentSelector: "#gdpr-shield, .site-modal--newsletter" });
    const style = calledWith("addStyleTag");
    const css = (style?.args[0] as { content: string }).content;
    expect(css).toContain(CONSENT_SELECTOR);
    expect(css).toContain("#gdpr-shield, .site-modal--newsletter");
  });
});

describe("reports/header-image consentHideRule", () => {
  it("targets class and id substrings for cookie and consent, case-insensitively", () => {
    expect(CONSENT_SELECTOR).toBe(
      '[class*="cookie" i],[id*="cookie" i],[class*="consent" i],[id*="consent" i]',
    );
    const rule = consentHideRule();
    expect(rule.startsWith(CONSENT_SELECTOR)).toBe(true);
    expect(rule).toContain("display:none!important");
  });

  it("joins a custom selector onto the heuristic rather than replacing it", () => {
    const rule = consentHideRule("#custom");
    expect(rule.startsWith(`${CONSENT_SELECTOR},#custom{`)).toBe(true);
  });

  it("ignores an empty custom selector", () => {
    expect(consentHideRule("")).toBe(consentHideRule());
    expect(consentHideRule("   ")).toBe(consentHideRule());
  });
});
