/** OD 87 through the production cockpit handler (netlify/functions/fleet-homepage).
 *
 *  The adapter test covers only the env and auth gates; this one drives the
 *  handler's own store reads, on a file database (each ":memory:" open is a new
 *  one): a known site's dead letter is held off the cockpit for two replay cycles
 *  from its oldest row, and a failed read of that clock holds nothing and blanks
 *  nothing. */
import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import fleetHomepage from "../../netlify/functions/fleet-homepage.mjs";
import { openDb } from "../../src/db/client.js";
import { createDeadLetter } from "../../src/db/deadletter.js";
import { authHeader } from "../_helpers/basic-auth.js";

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function cockpitWithDeadLetterAged(hours: number, breakOldestRead = false) {
  const dir = mkdtempSync(join(tmpdir(), "od87-home-"));
  dirs.push(dir);
  const url = `file:${join(dir, "fleet.db")}`;
  const db = await openDb({ url });
  await db
    .insertInto("sites")
    .values({
      id: "recA",
      slug: "acme-co",
      name: "Acme Co",
      url: "https://acme.example.com",
      status: "maintained",
    } as never)
    .execute();
  await createDeadLetter(db, {
    siteSlug: "acme-co",
    payload: { email: "ada@example.com" },
    turnstile: { outcome: "pass", hostname: "acme.example.com" },
    error: "Error: upstream 429 quota",
    receivedAt: new Date(Date.now() - hours * 60 * 60 * 1000),
  });
  if (breakOldestRead) {
    // Only the hold's clock fails: the count still reads, received_at does not.
    await sql`DROP INDEX idx_deadletter_slug_received`.execute(db);
    await sql`ALTER TABLE submission_deadletter DROP COLUMN received_at`.execute(db);
  }
  await db.destroy();
  vi.stubEnv("TURSO_DATABASE_URL", url);
  vi.stubEnv("TURSO_AUTH_TOKEN", "");
  vi.stubEnv("DASHBOARD_PASSWORD", "s3cret");
  const req = new Request("https://dash.reddoor.test/", {
    method: "GET",
    headers: authHeader("s3cret"),
  });
  // @ts-expect-error — minimal Context
  const res = await fleetHomepage(req, {});
  return { status: res.status, html: await res.text() };
}

describe("fleet-homepage — a known site's dead letter waits two replay cycles (OD 87)", () => {
  it("aged 3 h: the cockpit renders without it", async () => {
    const { status, html } = await cockpitWithDeadLetterAged(3);
    expect(status).toBe(200);
    expect(html).toContain("Acme Co");
    expect(html).not.toContain("dead-lettered");
  });

  it("aged 13 h: the cockpit alarms, with the age (positive control)", async () => {
    const { status, html } = await cockpitWithDeadLetterAged(13);
    expect(status).toBe(200);
    expect(html).toContain("1 lead dead-lettered and not replayed for 13 h");
  });

  it("a failed oldest-row read neither blanks the cockpit nor holds the alarm", async () => {
    const { status, html } = await cockpitWithDeadLetterAged(3, true);
    expect(status).toBe(200);
    expect(html).toContain("1 lead dead-lettered and not yet replayed");
  });
});
