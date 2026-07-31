import { describe, it, expect } from "vitest";
import { captureHomepage, type Shooter } from "../../../src/reports/header-image/capture.js";

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
});
