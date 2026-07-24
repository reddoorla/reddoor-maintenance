import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBluxCommand } from "../../../src/cli/commands/blux.js";
import type { FrozenManifest } from "../../../src/blux/freeze/types.js";

/** Minimal Response-likes — only `.ok`, `.status`, `.json`, `.text`, `.blob`
 *  are read by run-migration.ts. Mirrors the run-migration test harness. */
function jsonRes(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => "",
  } as unknown as Response;
}
function blobRes(): Response {
  return { ok: true, status: 200, blob: async () => new Blob(["x"]) } as unknown as Response;
}

const CF_HERO = "https://d1.cloudfront.net/img/hero.jpg";
const CF_SOCIAL = "https://d2.cloudfront.net/meta/social.jpg";

const MANIFEST: FrozenManifest = {
  site: "testsite",
  uid: "home",
  title: "Test Site Home",
  metaTitle: "Test Meta Title",
  metaImageUrl: CF_SOCIAL,
  fontLinks: ["https://fonts.googleapis.com/css2?family=Foo"],
  slots: [
    // Freeze stores a text node's RAW source — entities already encoded.
    { key: "s1.t0", kind: "text", text: "Hello &amp; welcome", section: "s1" },
    { key: "s1.i0", kind: "image", url: CF_HERO, section: "s1" },
  ],
};

describe("blux migrate-frozen", () => {
  const saved: Record<string, string | undefined> = {};
  let out = "";

  beforeEach(async () => {
    for (const k of ["PRISMIC_REPOSITORY_NAME", "PRISMIC_WRITE_TOKEN", "PRISMIC_ACCESS_TOKEN"])
      saved[k] = process.env[k];
    process.env.PRISMIC_REPOSITORY_NAME = "repo";
    process.env.PRISMIC_WRITE_TOKEN = "tok";
    delete process.env.PRISMIC_ACCESS_TOKEN;
    out = await mkdtemp(join(tmpdir(), "frozen-migrate-"));
    await writeFile(join(out, "testsite.slots.json"), JSON.stringify(MANIFEST), "utf-8");
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    for (const k of ["PRISMIC_REPOSITORY_NAME", "PRISMIC_WRITE_TOKEN", "PRISMIC_ACCESS_TOKEN"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await rm(out, { recursive: true, force: true });
  });

  it("pushes frozen_page, uploads image slots, and POSTs an unpublished doc carrying Prismic (not CDN) refs", async () => {
    // Stateful media library: phase 1 uploads (library empty), phase 2 re-lists
    // the same assets into run-migration's by-filename reuse branch.
    const library: { id: string; filename: string; url: string }[] = [];
    const customTypeInserts: { id?: string; format?: string }[] = [];
    const uploadedFilenames: string[] = [];
    let postedDocBody: {
      type: string;
      uid: string;
      data: {
        title: string;
        meta_title: string;
        meta_image?: unknown;
        slots: { key: string; kind: string; text?: unknown; image?: unknown }[];
      };
    } | null = null;
    let publishCalls = 0;

    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      // Custom Types API — insert succeeds (no update needed).
      if (url === "https://customtypes.prismic.io/customtypes/insert") {
        customTypeInserts.push(JSON.parse(String(init?.body)));
        return jsonRes({});
      }
      // Asset library listing (paginates once — no cursor).
      if (url.startsWith("https://asset-api.prismic.io/assets?")) {
        return jsonRes({ items: library.slice() });
      }
      // Asset upload — record the filename (run-migration derives it from the CDN
      // url) and seed the library so phase 2 reuses it.
      if (url === "https://asset-api.prismic.io/assets" && method === "POST") {
        const fd = init?.body as FormData;
        const file = fd.get("file") as File | null;
        const filename = file?.name ?? `f${library.length}.bin`;
        const id = `prismic-asset-${filename}`;
        const purl = `https://images.prismic.io/repo/${filename}`;
        library.push({ id, filename, url: purl });
        uploadedFilenames.push(filename);
        return jsonRes({ id, url: purl });
      }
      // The CDN blob fetch that precedes an upload.
      if (url.includes("cloudfront.net")) return blobRes();
      // Document create — capture the POST body; ok → created.
      if (url === "https://migration.prismic.io/documents" && method === "POST") {
        postedDocBody = JSON.parse(String(init?.body));
        return jsonRes({});
      }
      // A publish/release call would mean the migration was NOT left unpublished.
      if (/releases|\/publish/.test(url)) {
        publishCalls++;
        return jsonRes({});
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    });
    vi.stubGlobal("fetch", mockFetch as unknown as typeof fetch);

    const r = await runBluxCommand("migrate-frozen", out, { out });

    expect(r.code).toBe(0);

    // (a) the frozen_page custom type was pushed
    expect(customTypeInserts).toHaveLength(1);
    expect(customTypeInserts[0]!.id).toBe("frozen_page");
    expect(customTypeInserts[0]!.format).toBe("page");

    // (b) the doc POST targets type frozen_page with the manifest uid
    expect(postedDocBody).not.toBeNull();
    const body = postedDocBody!;
    expect(body.type).toBe("frozen_page");
    expect(body.uid).toBe("home");
    expect(body.data.title).toBe("Test Site Home");
    expect(body.data.meta_title).toBe("Test Meta Title");

    // (c) image slots reference the UPLOADED Prismic asset (by id) — never the CDN url
    const imgSlot = body.data.slots.find((s) => s.kind === "image")!;
    expect(imgSlot.key).toBe("s1.i0");
    expect(imgSlot.image).toEqual({ id: "prismic-asset-hero.jpg" });
    expect(imgSlot.text).toBeUndefined();
    // meta_image resolved to the uploaded social asset id too
    expect(body.data.meta_image).toEqual({ id: "prismic-asset-social.jpg" });
    // the hero + social CDN images were actually uploaded to Prismic
    expect(uploadedFilenames).toContain("hero.jpg");
    expect(uploadedFilenames).toContain("social.jpg");
    // NO cloudfront url survives anywhere in the posted document
    expect(JSON.stringify(body)).not.toContain("cloudfront.net");

    // (d) text slots carry their text as a resolved single-paragraph Rich Text value
    const txtSlot = body.data.slots.find((s) => s.kind === "text")!;
    expect(txtSlot.key).toBe("s1.t0");
    expect(txtSlot.image).toBeUndefined();
    const nodes = txtSlot.text as { type: string; text: string }[];
    expect(Array.isArray(nodes)).toBe(true);
    expect(nodes[0]!.type).toBe("paragraph");
    expect(nodes[0]!.text).toBe("Hello & welcome");

    // (e) the migration release is UNPUBLISHED — the runner never publishes, and
    // the summary tells the operator to do it in the dashboard.
    expect(publishCalls).toBe(0);
    expect(r.output).toContain("frozen_page pushed");
    expect(r.output).toContain("publish the migration release in the dashboard");
  });

  it("errors (code 1) when no manifest is present", async () => {
    await rm(join(out, "testsite.slots.json"), { force: true });
    const r = await runBluxCommand("migrate-frozen", out, { out });
    expect(r.code).toBe(1);
    expect(r.output).toContain("run 'blux freeze' first");
  });

  it("errors (code 1) without a directory", async () => {
    const r = await runBluxCommand("migrate-frozen", undefined, {});
    expect(r.code).toBe(1);
    expect(r.output).toContain("needs the frozen --out dir");
  });
});
