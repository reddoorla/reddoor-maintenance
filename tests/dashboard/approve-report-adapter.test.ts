import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../src/reports/airtable/client.js", () => ({
  openBase: vi.fn(() => ((t: string) => t) as unknown),
}));
vi.mock("../../src/dashboard/approve.js", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, approveReport: vi.fn() };
});
import { approveReport } from "../../src/dashboard/approve.js";
import approveReportFn from "../../netlify/functions/approve-report.mjs";

const approveMock = vi.mocked(approveReport);

// "op:s3cret" base64 — username ignored, password is the gate.
const AUTH = "Basic " + Buffer.from("op:s3cret").toString("base64");

function post(id: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://x/api/reports/${id}/approve`, { method: "POST", headers });
}

describe("approve-report adapter — env + method gating", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.AIRTABLE_PAT = "pat";
    process.env.AIRTABLE_BASE_ID = "appX";
    process.env.DASHBOARD_PASSWORD = "s3cret";
    approveMock.mockReset();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("GET returns a 200 presence-only health check (never leaks values)", async () => {
    process.env.DASHBOARD_PASSWORD = "should_not_leak";
    // @ts-expect-error — Netlify Context unused for GET
    const res = await approveReportFn(new Request("https://x/", { method: "GET" }), {});
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain("should_not_leak");
    expect(JSON.parse(raw).env).toEqual({
      AIRTABLE_PAT: true,
      AIRTABLE_BASE_ID: true,
      DASHBOARD_PASSWORD: true,
    });
  });

  it("405s on a non-POST/non-GET method", async () => {
    const res = await approveReportFn(
      new Request("https://x/api/reports/recREP1/approve", { method: "DELETE" }),
      // @ts-expect-error — minimal Context (only params needed)
      { params: { id: "recREP1" } },
    );
    expect(res.status).toBe(405);
  });

  it("403s a cross-site POST (Sec-Fetch-Site: cross-site) before touching the handler", async () => {
    const res = await approveReportFn(
      post("recREP1", { authorization: AUTH, "sec-fetch-site": "cross-site" }),
      // @ts-expect-error — minimal Context
      { params: { id: "recREP1" } },
    );
    expect(res.status).toBe(403);
    expect(approveMock).not.toHaveBeenCalled();
  });

  it("proceeds for a same-origin POST (Sec-Fetch-Site: same-origin)", async () => {
    approveMock.mockResolvedValue({ status: "approved", reportId: "recREP1" });
    const res = await approveReportFn(
      post("recREP1", { authorization: AUTH, "sec-fetch-site": "same-origin" }),
      // @ts-expect-error — minimal Context
      { params: { id: "recREP1" } },
    );
    expect(res.status).toBe(200);
    expect(approveMock).toHaveBeenCalledWith(expect.anything(), "recREP1");
  });

  it("proceeds when no cross-site signal at all (no Sec-Fetch, no Origin, no Referer — legacy/non-browser)", async () => {
    approveMock.mockResolvedValue({ status: "approved", reportId: "recREP1" });
    // @ts-expect-error — minimal Context
    const res = await approveReportFn(post("recREP1", { authorization: AUTH }), {
      params: { id: "recREP1" },
    });
    expect(res.status).toBe(200);
    expect(approveMock).toHaveBeenCalledWith(expect.anything(), "recREP1");
  });

  it("proceeds when Sec-Fetch-Site is absent but the Origin host matches the request host", async () => {
    // post() builds a request to https://x/... so the request host is "x".
    approveMock.mockResolvedValue({ status: "approved", reportId: "recREP1" });
    const res = await approveReportFn(
      post("recREP1", { authorization: AUTH, origin: "https://x" }),
      // @ts-expect-error — minimal Context
      { params: { id: "recREP1" } },
    );
    expect(res.status).toBe(200);
    expect(approveMock).toHaveBeenCalledWith(expect.anything(), "recREP1");
  });

  it("403s when Sec-Fetch-Site is absent and the Origin host is a different origin", async () => {
    const res = await approveReportFn(
      post("recREP1", { authorization: AUTH, origin: "https://evil.example.com" }),
      // @ts-expect-error — minimal Context
      { params: { id: "recREP1" } },
    );
    expect(res.status).toBe(403);
    expect(approveMock).not.toHaveBeenCalled();
  });

  it("falls back to the Referer origin when Origin is absent (cross-origin Referer → 403)", async () => {
    const res = await approveReportFn(
      post("recREP1", { authorization: AUTH, referer: "https://evil.example.com/some/path" }),
      // @ts-expect-error — minimal Context
      { params: { id: "recREP1" } },
    );
    expect(res.status).toBe(403);
    expect(approveMock).not.toHaveBeenCalled();
  });

  it("proceeds when Origin is absent but the Referer origin matches the request host", async () => {
    approveMock.mockResolvedValue({ status: "approved", reportId: "recREP1" });
    const res = await approveReportFn(
      post("recREP1", { authorization: AUTH, referer: "https://x/s/acme" }),
      // @ts-expect-error — minimal Context
      { params: { id: "recREP1" } },
    );
    expect(res.status).toBe(200);
    expect(approveMock).toHaveBeenCalledWith(expect.anything(), "recREP1");
  });

  it("401s an unauthenticated POST and never touches the handler", async () => {
    // @ts-expect-error — minimal Context
    const res = await approveReportFn(post("recREP1"), { params: { id: "recREP1" } });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/Basic realm="Reddoor fleet"/);
    expect(approveMock).not.toHaveBeenCalled();
  });

  it("500s when Airtable env is missing", async () => {
    delete process.env.AIRTABLE_PAT;
    // @ts-expect-error — minimal Context
    const res = await approveReportFn(post("recREP1", { authorization: AUTH }), {
      params: { id: "recREP1" },
    });
    expect(res.status).toBe(500);
  });

  it("returns 409 (not 2xx) when approve is blocked, so the client's res.ok check reads Failed", async () => {
    approveMock.mockResolvedValue({
      status: "blocked",
      reportId: "recREP1",
      reason: "send-blocked",
      blockers: ["recipients-missing: no recipients"],
    });
    const res = await approveReportFn(
      post("recREP1", { authorization: AUTH, "sec-fetch-site": "same-origin" }),
      // @ts-expect-error — minimal Context
      { params: { id: "recREP1" } },
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "send-blocked" });
  });

  it("authenticated POST calls approveReport with the :id and returns 200 on approve", async () => {
    approveMock.mockResolvedValue({ status: "approved", reportId: "recREP1" });
    // @ts-expect-error — minimal Context
    const res = await approveReportFn(post("recREP1", { authorization: AUTH }), {
      params: { id: "recREP1" },
    });
    expect(res.status).toBe(200);
    expect(approveMock).toHaveBeenCalledWith(expect.anything(), "recREP1");
    expect(((await res.json()) as { status: string }).status).toBe("approved");
  });

  it("returns 200 for an idempotent no-op (already-approved/already-sent)", async () => {
    approveMock.mockResolvedValue({
      status: "noop",
      reportId: "recREP1",
      reason: "already-approved",
    });
    // @ts-expect-error — minimal Context
    const res = await approveReportFn(post("recREP1", { authorization: AUTH }), {
      params: { id: "recREP1" },
    });
    expect(res.status).toBe(200);
  });

  it("returns 404 when the handler reports not-found", async () => {
    approveMock.mockResolvedValue({ status: "not-found", reportId: "recNOPE" });
    // @ts-expect-error — minimal Context
    const res = await approveReportFn(post("recNOPE", { authorization: AUTH }), {
      params: { id: "recNOPE" },
    });
    expect(res.status).toBe(404);
  });
});
