import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { openBase } from "../../../src/reports/airtable/client.js";

const QUOTA_BODY = JSON.stringify({
  errors: [
    {
      error: "PUBLIC_API_BILLING_LIMIT_EXCEEDED",
      message:
        "API billing plan limit exceeded. You've reached the maximum number of requests allowed for this month.",
    },
  ],
});

let server: Server;
let hits = 0;
let mode: "ok" | "quota" = "ok";
const previousEndpoint = process.env.AIRTABLE_ENDPOINT_URL;

beforeAll(async () => {
  server = createServer((req, res) => {
    hits++;
    req.resume();
    req.on("end", () => {
      if (mode === "quota") {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(QUOTA_BODY);
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          req.method === "PATCH"
            ? { records: [{ id: "recEXIST", fields: {} }] }
            : {
                records: [{ id: "recEXIST", createdTime: "2026-09-28T00:00:00.000Z", fields: {} }],
              },
        ),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.AIRTABLE_ENDPOINT_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (previousEndpoint === undefined) delete process.env.AIRTABLE_ENDPOINT_URL;
  else process.env.AIRTABLE_ENDPOINT_URL = previousEndpoint;
  await new Promise<void>((r) => server.close(() => r()));
});

const open = () => openBase({ apiKey: "patFAKE", baseId: "appFAKE" });

describe("openBase against a real HTTP 429 quota response", () => {
  it("reads normally when Airtable answers 200 (known-good control)", async () => {
    mode = "ok";
    hits = 0;
    const records = await open()("Websites").select({ maxRecords: 1 }).firstPage();
    expect(records.map((r) => r.id)).toEqual(["recEXIST"]);
    expect(hits).toBe(1);
  });

  it("rejects a read after one request instead of retrying forever", async () => {
    mode = "quota";
    hits = 0;
    const started = Date.now();
    const err = await open()("Websites")
      .select({ maxRecords: 1 })
      .firstPage()
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({ code: "AIRTABLE_QUOTA_EXHAUSTED", statusCode: 429 });
    expect(hits).toBe(1);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("rejects a write after one request instead of retrying forever", async () => {
    mode = "quota";
    hits = 0;
    const err = await open()("Websites")
      .update([{ id: "recEXIST", fields: { Name: "x" } }])
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toMatchObject({ code: "AIRTABLE_QUOTA_EXHAUSTED" });
    expect(hits).toBe(1);
  });
});
