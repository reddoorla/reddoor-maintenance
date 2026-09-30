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
/** Set per-test to make the best-effort consent click reject, the way a banner
 *  that animates or re-renders under the pointer makes it reject in production. */
let consentClickRejects = false;
/** A consent banner present at the first look (after fonts), before the settle. */
let earlyBanner = false;
/** Set once a fake banner button is clicked; the banner is then gone. */
let dismissed = false;
/** Consent buttons present after the settle: 0 unless a test mounts a late banner. */
let lateConsentButtons = 0;

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
      const banner = (kind: "early" | "late") => ({
        isVisible: async () => {
          record("isVisible", kind);
          return !dismissed;
        },
        evaluate: async (...evalArgs: unknown[]) => {
          record("locatorEvaluate", ...evalArgs);
          return "We use cookies to track website usage.";
        },
        click: async (...clickArgs: unknown[]) => {
          record(kind === "early" ? "click" : "lateClick", ...clickArgs);
          if (consentClickRejects) throw new Error("locator.click: Timeout 1500ms exceeded.");
          dismissed = true;
        },
      });
      return {
        all: async () => {
          record("all");
          if (dismissed) return [];
          const settled = calls.some((c) => c.name === "waitForTimeout");
          if (!settled && earlyBanner) return [banner("early")];
          if (settled && lateConsentButtons > 0) return [banner("late")];
          return [];
        },
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
    earlyBanner = false;
    lateConsentButtons = 0;
    dismissed = false;
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
    earlyBanner = false;
    lateConsentButtons = 0;
    dismissed = false;
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

  it("clicks a banner that is there at the first look, before the style tag and the settle", async () => {
    earlyBanner = true;
    await shoot();
    const role = calledWith("getByRole");
    expect(role?.args[0]).toBe("button");
    expect((role?.args[1] as { name: RegExp }).name).toBe(CONSENT_BUTTON_NAME);
    const click = calledWith("click");
    expect((click?.args[0] as { timeout: number }).timeout).toBeLessThanOrEqual(2000);
    expect(order("click")).toBeLessThan(order("addStyleTag"));
    expect(order("click")).toBeLessThan(order("waitForTimeout"));
    expect(calledWith("lateClick")).toBeUndefined();
  });

  it("clicks nothing when no consent overlay is found", async () => {
    await shoot();
    expect(calledWith("click")).toBeUndefined();
    expect(calledWith("lateClick")).toBeUndefined();
    expect(calledWith("screenshot")).toBeDefined();
  });

  it("is a no-op where the early click fails: it still hides, settles and shoots", async () => {
    earlyBanner = true;
    consentClickRejects = true;
    const bytes = await shoot();
    expect(calledWith("click")).toBeDefined();
    expect(bytes).toEqual(SHOT);
    expect(calledWith("addStyleTag")).toBeDefined();
    expect(calledWith("waitForTimeout")?.args[0]).toBe(2500);
    expect(closed).toBe(true);
  });

  it("looks again after the settle, clicks a late banner, and lets it leave before the shutter", async () => {
    lateConsentButtons = 1;
    await shoot();
    const names = calls.map((c) => c.name);
    const settle = names.indexOf("waitForTimeout");
    const lateClick = names.indexOf("lateClick");
    expect(names.indexOf("all", settle)).toBeGreaterThan(settle);
    expect(lateClick).toBeGreaterThan(settle);
    expect(names.lastIndexOf("waitForTimeout")).toBeGreaterThan(lateClick);
    expect(names.lastIndexOf("all")).toBeGreaterThan(lateClick);
    expect(names.lastIndexOf("all")).toBeLessThan(order("screenshot"));
  });

  it("polls for a late banner for 1.5s at most, then shoots", async () => {
    await shoot();
    const waits = calls.filter((c) => c.name === "waitForTimeout").map((c) => c.args[0]);
    expect(waits[0]).toBe(2500);
    expect(waits.slice(1).reduce((a, b) => (a as number) + (b as number), 0)).toBe(1500);
    expect(calls.filter((c) => c.name === "all")).toHaveLength(8);
    expect(calledWith("lateClick")).toBeUndefined();
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
