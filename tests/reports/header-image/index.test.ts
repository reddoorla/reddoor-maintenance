import { describe, it, expect } from "vitest";
import sharp from "sharp";
import {
  generateHeaderImage,
  applyReportTypeHeadline,
} from "../../../src/reports/header-image/index.js";
import { headlineInkCount } from "../../../src/reports/header-image/compose.js";
import type { Shooter } from "../../../src/reports/header-image/capture.js";

async function shot(color = "#123456"): Promise<Uint8Array> {
  const png = await sharp({
    create: { width: 1600, height: 1000, channels: 3, background: color },
  })
    .png()
    .toBuffer();
  return new Uint8Array(png);
}

const shooter: Shooter = { shoot: async () => shot() };

describe("reports/header-image generateHeaderImage", () => {
  it("produces a 2400x3200 JPEG for a site", async () => {
    const out = await generateHeaderImage({ url: "https://acme.com/", shooter });
    const meta = await sharp(Buffer.from(out.bytes)).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(2400);
    expect(meta.height).toBe(3200);
  });

  it("derives the printed domain from the URL, without scheme, www or slash", async () => {
    const out = await generateHeaderImage({ url: "https://www.acme.com/", shooter });
    expect(out.domain).toBe("acme.com");
  });

  it("keeps a non-www host intact", async () => {
    const out = await generateHeaderImage({ url: "https://1836dig.com/", shooter });
    expect(out.domain).toBe("1836dig.com");
  });

  it("names the file after the site slug", async () => {
    const out = await generateHeaderImage({ url: "https://acme.com/", slug: "acme", shooter });
    expect(out.filename).toBe("acmeHeader.jpg");
  });

  it("rejects a blank capture rather than overwriting a good header", async () => {
    const blank: Shooter = {
      shoot: async () =>
        new Uint8Array(
          await sharp({
            create: { width: 1600, height: 1000, channels: 3, background: "#ffffff" },
          })
            .png()
            .toBuffer(),
        ),
    };
    await expect(generateHeaderImage({ url: "https://acme.com/", shooter: blank })).rejects.toThrow(
      /blank/i,
    );
  });
});

describe("reports/header-image applyReportTypeHeadline", () => {
  it("stamps a distinct headline for every registered type", async () => {
    const { bytes } = await generateHeaderImage({ url: "https://acme.com/", shooter });
    const kinds = ["Maintenance", "Testing", "Announcement", "Launch"] as const;

    const stamped = new Map<string, Buffer>();
    for (const kind of kinds) {
      const out = Buffer.from(await applyReportTypeHeadline(bytes, kind));
      // Every registered type must actually change the header...
      expect(out.equals(Buffer.from(bytes))).toBe(false);
      // ...and each must differ from the others, which catches a
      // HEADLINE_FILES entry pointing at the wrong asset.
      for (const [other, buf] of stamped) {
        expect(`${kind} vs ${other}: ${out.equals(buf)}`).toBe(`${kind} vs ${other}: false`);
      }
      stamped.set(kind, out);
    }
  });

  it("passes an unregistered report type straight through", async () => {
    const { bytes } = await generateHeaderImage({ url: "https://acme.com/", shooter });
    expect(await applyReportTypeHeadline(bytes, "Nonsense")).toBe(bytes);
  });

  // REGRESSION (2026-08-24): a header built on the OLD baked plate already has a
  // headline. Stamping printed the new one directly over it and the two
  // overprinted into unreadable pulp — that shipped in a real announcement.
  // Canvas-sized headers passed the only guard there was, so nothing caught it.
  it("refuses to stamp a header that already carries a headline", async () => {
    const { bytes } = await generateHeaderImage({ url: "https://acme.com/", shooter });
    // Simulate a pre-switch header: one whose headline is already part of the image.
    const baked = await applyReportTypeHeadline(bytes, "Maintenance");
    expect(await headlineInkCount(baked)).toBeGreaterThan(40_000);

    const again = await applyReportTypeHeadline(baked, "Announcement");
    expect(again).toBe(baked); // same reference: untouched, not re-encoded
  });

  it("sees an empty headline band on a freshly generated (clean-plate) header", async () => {
    const { bytes } = await generateHeaderImage({ url: "https://acme.com/", shooter });
    expect(await headlineInkCount(bytes)).toBe(0);
  });

  it("skips (never throws) on a non-canvas-sized header, returning it as stored", async () => {
    const legacy = new Uint8Array(
      await sharp({ create: { width: 600, height: 800, channels: 3, background: "#ffffff" } })
        .jpeg()
        .toBuffer(),
    );
    expect(await applyReportTypeHeadline(legacy, "Maintenance")).toBe(legacy);
  });
});
