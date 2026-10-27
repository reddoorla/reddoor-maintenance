import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isHttpError, isRedirect } from "@sveltejs/kit";
import { openDb, type Db } from "../../../src/db/client.js";
import { actions } from "../../src/routes/submissions/+page.server.js";
import { load } from "../../src/routes/submissions/+page.js";
import { runPage } from "../_helpers/snapshot-load.js";
import type { SubmissionsPageModel } from "../../../src/dashboard/submissions-page.js";

/**
 * /submissions server side (#582): the bulk mark-read form action keeps the
 * Netlify function's contract — a cross-site POST is a 403, an unknown site a
 * 404, an unknown action a 400 that writes nothing, and a mark-read a 303 back
 * to the same filtered view. Real libSQL in a temp `file:` database.
 */

const ORIGINAL_ENV = { ...process.env };
let dir: string;
let db: Db;

async function seed() {
  for (const [id, name, slug] of [
    ["recA", "Acme", "acme"],
    ["recB", "Beta", "beta"],
  ] as const) {
    await db
      .insertInto("sites")
      .values({ id, slug, name, url: `https://${slug}.example.com`, status: "maintained" } as never)
      .execute();
  }
  for (const [id, site] of [
    ["sub1", "recA"],
    ["sub2", "recB"],
  ] as const) {
    await db
      .insertInto("submissions")
      .values({
        id,
        site_id: site,
        form_type: "contact",
        name: "Pat",
        email: "pat@example.com",
        status: "new",
        notify_status: "sent",
        submitted_at: "2026-10-19T10:00:00.000Z",
      } as never)
      .execute();
  }
}

function post(body: string, headers: Record<string, string> = { "sec-fetch-site": "same-origin" }) {
  return new Request("https://dash.example/submissions", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body,
  });
}

/** Run the default action and return what it threw (it always throws: an
 *  error or a redirect). */
async function act(request: Request): Promise<unknown> {
  try {
    // @ts-expect-error — only `request` is read
    await actions.default({ request });
  } catch (thrown) {
    return thrown;
  }
  throw new Error("action returned instead of throwing");
}

async function statuses() {
  const rows = await db.selectFrom("submissions").select(["id", "status"]).execute();
  return Object.fromEntries(rows.map((r) => [r.id, r.status]));
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "cockpit-submissions-"));
  const url = `file:${join(dir, "db.sqlite")}`;
  process.env = { ...ORIGINAL_ENV, TURSO_DATABASE_URL: url };
  delete process.env.TURSO_AUTH_TOKEN;
  db = await openDb({ url });
  await seed();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  rmSync(dir, { recursive: true, force: true });
});

describe("the mark-read action", () => {
  it("rejects a cross-site request with a 403 and writes nothing", async () => {
    const thrown = await act(post("action=mark-read", { "sec-fetch-site": "cross-site" }));
    expect(isHttpError(thrown) && thrown.status).toBe(403);
    expect(isHttpError(thrown) && thrown.body.message).toBe("Cross-site request rejected.");
    expect(await statuses()).toEqual({ sub1: "new", sub2: "new" });
  });

  it("answers an unknown site with a 404 naming the slug", async () => {
    const thrown = await act(post("action=mark-read&site=nope"));
    expect(isHttpError(thrown) && thrown.status).toBe(404);
    expect(isHttpError(thrown) && thrown.body.message).toBe("No site found for slug 'nope'.");
  });

  it("answers an unknown action with a 400 and writes nothing", async () => {
    const thrown = await act(post("action=delete"));
    expect(isHttpError(thrown) && thrown.status).toBe(400);
    expect(isHttpError(thrown) && thrown.body.message).toBe("Unknown action.");
    expect(await statuses()).toEqual({ sub1: "new", sub2: "new" });
  });

  it("marks only the filtered bucket read and 303s back to that view", async () => {
    const thrown = await act(post("action=mark-read&site=acme&q="));
    expect(isRedirect(thrown) && thrown.status).toBe(303);
    expect(isRedirect(thrown) && thrown.location).toBe("/submissions?site=acme");
    expect(await statuses()).toEqual({ sub1: "read", sub2: "new" });
  });

  it("with no filter 303s to the bare page", async () => {
    const thrown = await act(post("action=mark-read"));
    expect(isRedirect(thrown) && thrown.location).toBe("/submissions");
    expect(await statuses()).toEqual({ sub1: "read", sub2: "read" });
  });
});

describe("the page load", () => {
  it("404s an unknown ?site= slug", async () => {
    try {
      await runPage(load, "/submissions?site=nope");
      throw new Error("load returned");
    } catch (thrown) {
      expect(isHttpError(thrown) && thrown.status).toBe(404);
    }
  });

  it("scopes the model to the site", async () => {
    const data = await runPage<{ model: SubmissionsPageModel }>(load, "/submissions?site=beta");
    expect(data.model.rows.map((r) => r.id)).toEqual(["sub2"]);
  });
});
