import { describe, it, expect, vi } from "vitest";
import type { Browser } from "@playwright/test";
import { renderReportPdf } from "../../src/prospect/pdf.js";

const PDF = Buffer.from("%PDF-1.4 fake");

type Recorded = {
  goto: ReturnType<typeof vi.fn>;
  pdf: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

/** A browser stub that records what the renderer asked it to do. */
function fakeBrowser(over: { goto?: () => Promise<unknown>; pdf?: () => Promise<Buffer> } = {}) {
  const rec: Recorded = {
    goto: vi.fn(over.goto ?? (async () => ({ ok: () => true, status: () => 200 }))),
    pdf: vi.fn(over.pdf ?? (async () => PDF)),
    close: vi.fn(async () => undefined),
  };
  const browser = {
    newPage: async () => ({ goto: rec.goto, pdf: rec.pdf }),
    close: rec.close,
  } as unknown as Browser;
  return { browser, rec };
}

describe("renderReportPdf", () => {
  it("returns the rendered bytes", async () => {
    const { browser } = fakeBrowser();
    await expect(
      renderReportPdf("https://reddoorla.com/audit/abc/print", { launch: async () => browser }),
    ).resolves.toBe(PDF);
  });

  it("navigates to the URL it was given", async () => {
    const { browser, rec } = fakeBrowser();
    const url = "https://reddoorla.com/audit/abc/print";
    await renderReportPdf(url, { launch: async () => browser });
    expect(rec.goto.mock.calls[0]![0]).toBe(url);
  });

  // A fallback face baked into a client-facing PDF cannot be corrected after
  // the fact — the file is already in somebody's inbox.
  it("waits for the network to settle, so webfonts are loaded before printing", async () => {
    const { browser, rec } = fakeBrowser();
    await renderReportPdf("https://x.test/print", { launch: async () => browser });
    expect((rec.goto.mock.calls[0]![1] as { waitUntil: string }).waitUntil).toBe("networkidle");
  });

  it("honours the document's own @page size rather than restating it", async () => {
    const { browser, rec } = fakeBrowser();
    await renderReportPdf("https://x.test/print", { launch: async () => browser });
    const opts = rec.pdf.mock.calls[0]![0] as {
      preferCSSPageSize: boolean;
      printBackground: boolean;
    };
    expect(opts.preferCSSPageSize).toBe(true);
    expect(opts.printBackground).toBe(true);
  });
});

// A wedged render must not leave a chromium process behind on the runner.
describe("renderReportPdf — cleanup", () => {
  it("closes the browser on success", async () => {
    const { browser, rec } = fakeBrowser();
    await renderReportPdf("https://x.test/print", { launch: async () => browser });
    expect(rec.close).toHaveBeenCalledTimes(1);
  });

  it("closes the browser when navigation fails", async () => {
    const { browser, rec } = fakeBrowser({
      goto: async () => {
        throw new Error("net::ERR_CONNECTION_REFUSED");
      },
    });
    await expect(
      renderReportPdf("https://x.test/print", { launch: async () => browser }),
    ).rejects.toThrow(/ERR_CONNECTION_REFUSED/);
    expect(rec.close).toHaveBeenCalledTimes(1);
  });

  it("closes the browser when the render itself fails", async () => {
    const { browser, rec } = fakeBrowser({
      pdf: async () => {
        throw new Error("render exploded");
      },
    });
    await expect(
      renderReportPdf("https://x.test/print", { launch: async () => browser }),
    ).rejects.toThrow(/render exploded/);
    expect(rec.close).toHaveBeenCalledTimes(1);
  });
});

// A 404 print route must NOT become a valid PDF of the "Page not found" page,
// attached to the email and sent to the prospect. page.goto resolves for any
// status, so the status has to be checked explicitly.
describe("renderReportPdf — refuses to print an error page", () => {
  it.each([404, 500, 502])("throws on HTTP %i rather than rendering it", async (status) => {
    const { browser, rec } = fakeBrowser({
      goto: async () => ({ ok: () => false, status: () => status }),
    });
    await expect(
      renderReportPdf("https://x.test/print", { launch: async () => browser }),
    ).rejects.toThrow(new RegExp(String(status)));
    expect(rec.pdf).not.toHaveBeenCalled();
    expect(rec.close).toHaveBeenCalledTimes(1);
  });

  it("throws when there is no response at all", async () => {
    const { browser, rec } = fakeBrowser({ goto: async () => null });
    await expect(
      renderReportPdf("https://x.test/print", { launch: async () => browser }),
    ).rejects.toThrow(/no response/);
    expect(rec.pdf).not.toHaveBeenCalled();
  });

  it("still prints a healthy page", async () => {
    const { browser, rec } = fakeBrowser();
    await renderReportPdf("https://x.test/print", { launch: async () => browser });
    expect(rec.pdf).toHaveBeenCalledTimes(1);
  });
});
