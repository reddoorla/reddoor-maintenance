import { describe, it, expect } from "vitest";
import {
  captureHomepage,
  UnstyledPageError,
  type Shooter,
} from "../../../src/reports/header-image/capture.js";

function shooter(over: Partial<Shooter> = {}): Shooter {
  return {
    shoot: async () => new Uint8Array([1, 2, 3]),
    ...over,
  };
}

describe("reports/header-image capture", () => {
  it("shoots the site's homepage at a 16:10 retina viewport", async () => {
    let seen: Parameters<Shooter["shoot"]>[0] | undefined;
    const bytes = await captureHomepage("https://acme.com/", {
      shooter: shooter({
        shoot: async (opts) => {
          seen = opts;
          return new Uint8Array([9]);
        },
      }),
    });
    expect(bytes).toEqual(new Uint8Array([9]));
    expect(seen?.url).toBe("https://acme.com/");
    expect(seen?.width).toBe(1600);
    expect(seen?.height).toBe(1000);
    expect(seen!.width / seen!.height).toBeCloseTo(1.6, 5);
    expect(seen?.deviceScaleFactor).toBe(2);
    expect(seen?.settleMs).toBe(2500);
  });

  it("honours an explicit settle delay for animation-heavy sites", async () => {
    let seen: Parameters<Shooter["shoot"]>[0] | undefined;
    await captureHomepage("https://acme.com/", {
      settleMs: 9000,
      shooter: shooter({
        shoot: async (opts) => {
          seen = opts;
          return new Uint8Array([9]);
        },
      }),
    });
    expect(seen?.settleMs).toBe(9000);
  });

  it("passes a per-site consentSelector through to the shooter, and omits the key when unset (#654)", async () => {
    const seen: Array<Parameters<Shooter["shoot"]>[0]> = [];
    const s = shooter({
      shoot: async (opts) => {
        seen.push(opts);
        return new Uint8Array([9]);
      },
    });
    await captureHomepage("https://acme.com/", { shooter: s, consentSelector: "#gdpr" });
    await captureHomepage("https://acme.com/", { shooter: s });
    expect(seen[0]?.consentSelector).toBe("#gdpr");
    expect("consentSelector" in seen[1]!).toBe(false);
  });

  it("propagates a capture failure rather than returning empty bytes", async () => {
    await expect(
      captureHomepage("https://acme.com/", {
        shooter: shooter({
          shoot: async () => {
            throw new Error("net::ERR_CONNECTION_REFUSED");
          },
        }),
      }),
    ).rejects.toThrow(/ERR_CONNECTION_REFUSED/);
  });

  it("re-shoots once when the page came back unstyled, and returns the second shot", async () => {
    let n = 0;
    const bytes = await captureHomepage("https://acme.com/", {
      shooter: {
        shoot: async () => {
          n++;
          if (n === 1)
            throw new UnstyledPageError("https://acme.com/", ["https://acme.com/a.css (HTTP 503)"]);
          return new Uint8Array([7]);
        },
      },
    });
    expect(n).toBe(2);
    expect(bytes).toEqual(new Uint8Array([7]));
  });

  it("refuses when the page is unstyled twice", async () => {
    let n = 0;
    const always: Shooter = {
      shoot: async () => {
        n++;
        throw new UnstyledPageError("https://acme.com/", ["https://acme.com/a.css (HTTP 404)"]);
      },
    };
    await expect(captureHomepage("https://acme.com/", { shooter: always })).rejects.toBeInstanceOf(
      UnstyledPageError,
    );
    expect(n).toBe(2);
  });

  it("does not re-shoot any other failure", async () => {
    let n = 0;
    await expect(
      captureHomepage("https://acme.com/", {
        shooter: {
          shoot: async () => {
            n++;
            throw new Error("navigation timeout");
          },
        },
      }),
    ).rejects.toThrow("navigation timeout");
    expect(n).toBe(1);
  });
});
