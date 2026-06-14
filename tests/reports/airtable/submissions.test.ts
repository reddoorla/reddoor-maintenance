import { describe, it, expect } from "vitest";
import {
  SUBMISSIONS_TABLE,
  createSubmission,
  listNewSubmissions,
  getSubmissionById,
  setSubmissionStatusRow,
  stampNotified,
  mapRow,
} from "../../../src/reports/airtable/submissions.js";
import { makeFakeBase, type CapturedCall } from "../_helpers/fake-airtable-base.js";

const firstCreate = (calls: CapturedCall[]) =>
  calls.find((c): c is Extract<CapturedCall, { kind: "create" }> => c.kind === "create");

describe("submissions table", () => {
  it("uses the exact Airtable table name", () => {
    expect(SUBMISSIONS_TABLE).toBe("Submissions");
  });

  it("createSubmission writes the linked Site, Status=new, and ISO Submitted at", async () => {
    const base = makeFakeBase();
    const row = await createSubmission(base, {
      siteId: "recSITE",
      formType: "contact",
      name: "Jane",
      email: "jane@example.com",
      message: "hi",
      extraFields: { company: "Acme" },
      submittedAt: new Date("2026-06-14T12:00:00Z"),
    });
    const created = firstCreate(base.__calls);
    const f = created!.records[0]!.fields;
    expect(f["Site"]).toEqual(["recSITE"]);
    expect(f["Status"]).toBe("new");
    expect(f["Submitted at"]).toBe("2026-06-14T12:00:00.000Z");
    expect(f["Extra fields"]).toBe('{"company":"Acme"}');
    expect(row.status).toBe("new");
    expect(row.siteId).toBe("recSITE");
  });

  it("createSubmission omits Extra fields when empty", async () => {
    const base = makeFakeBase();
    await createSubmission(base, {
      siteId: "recSITE",
      formType: "contact",
      name: "Jane",
      email: "jane@example.com",
      extraFields: {},
      submittedAt: new Date("2026-06-14T12:00:00Z"),
    });
    const f = firstCreate(base.__calls)!.records[0]!.fields;
    expect("Extra fields" in f).toBe(false);
  });

  it("mapRow coerces an unknown Form type to contact and missing Status to new", () => {
    const row = mapRow({ id: "rec1", fields: { "Form type": "weird", Site: ["recX"] } });
    expect(row.formType).toBe("contact");
    expect(row.status).toBe("new");
    expect(row.siteId).toBe("recX");
  });

  it("listNewSubmissions returns only Status=new rows", async () => {
    const base = makeFakeBase({
      Submissions: [
        { id: "rec1", fields: { Status: "new", "Submitted at": "2026-06-14T10:00:00Z" } },
        { id: "rec2", fields: { Status: "read", "Submitted at": "2026-06-14T11:00:00Z" } },
      ],
    });
    const rows = await listNewSubmissions(base);
    expect(rows.map((r) => r.id)).toEqual(["rec1"]);
  });

  it("getSubmissionById returns the matching row, null otherwise", async () => {
    const base = makeFakeBase({
      Submissions: [{ id: "rec1", fields: { Status: "new" } }],
    });
    expect((await getSubmissionById(base, "rec1"))?.id).toBe("rec1");
    expect(await getSubmissionById(base, "nope")).toBeNull();
  });

  it("setSubmissionStatusRow writes Status; stampNotified writes Notify status + message id", async () => {
    const base = makeFakeBase({ Submissions: [{ id: "rec1", fields: { Status: "new" } }] });
    await setSubmissionStatusRow(base, "rec1", "archived");
    await stampNotified(base, "rec1", "sent", "msg_123");
    const updates = base.__calls.filter((c) => c.kind === "update");
    expect((updates[0] as Extract<CapturedCall, { kind: "update" }>).records[0]!.fields).toEqual({
      Status: "archived",
    });
    expect((updates[1] as Extract<CapturedCall, { kind: "update" }>).records[0]!.fields).toEqual({
      "Notify status": "sent",
      "Resend message ID": "msg_123",
    });
  });
});
