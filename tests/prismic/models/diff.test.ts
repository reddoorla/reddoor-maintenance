// tests/prismic/models/diff.test.ts
import { describe, it, expect } from "vitest";
import { diffModels, describeDiff } from "../../../src/prismic/models/diff.js";
import type { LocalEntry, RemoteEntry } from "../../../src/prismic/models/types.js";

const ctLocal = (id: string, model: Record<string, unknown> = {}): LocalEntry => ({
  kind: "customtype",
  id,
  model: { id, ...model },
  path: `customtypes/${id}/index.json`,
});
const ctRemote = (id: string, model: Record<string, unknown> = {}): RemoteEntry => ({
  kind: "customtype",
  id,
  model: { id, ...model },
});
const sliceLocal = (id: string, model: Record<string, unknown> = {}): LocalEntry => ({
  kind: "slice",
  id,
  model: { id, type: "SharedSlice", ...model },
  path: `src/lib/slices/${id}/model.json`,
});
const sliceRemote = (id: string, model: Record<string, unknown> = {}): RemoteEntry => ({
  kind: "slice",
  id,
  model: { id, type: "SharedSlice", ...model },
});

describe("diffModels", () => {
  it("sorts an identical fleet into `unchanged`", () => {
    const d = diffModels(
      [ctLocal("page"), sliceLocal("hero")],
      [ctRemote("page"), sliceRemote("hero")],
    );
    expect(d.unchanged.map((e) => e.id).sort()).toEqual(["hero", "page"]);
    expect(d.toCreate).toEqual([]);
    expect(d.toUpdate).toEqual([]);
    expect(d.remoteOnly).toEqual([]);
  });

  it("puts a local-only model in toCreate", () => {
    const d = diffModels([ctLocal("page"), ctLocal("blog")], [ctRemote("page")]);
    expect(d.toCreate.map((e) => e.id)).toEqual(["blog"]);
  });

  it("puts a changed model in toUpdate, carrying BOTH sides", () => {
    const d = diffModels(
      [ctLocal("page", { label: "Page v2" })],
      [ctRemote("page", { label: "Page" })],
    );
    expect(d.toUpdate).toHaveLength(1);
    expect(d.toUpdate[0]!.local.model.label).toBe("Page v2");
    expect(d.toUpdate[0]!.remote.model.label).toBe("Page");
  });

  it("puts a remote-only model in remoteOnly and NEVER anywhere else", () => {
    const d = diffModels([ctLocal("page")], [ctRemote("page"), ctRemote("frozen_page")]);
    expect(d.remoteOnly.map((e) => e.id)).toEqual(["frozen_page"]);
    expect(d.toCreate).toEqual([]);
    expect(d.toUpdate).toEqual([]);
  });

  // A custom type and a slice may legitimately share an id — they live in
  // different Types API collections. Keying on id alone would pair them and
  // report a phantom update that a push would then send to the wrong endpoint.
  it("keys on kind AND id, so a customtype never matches a slice of the same id", () => {
    const d = diffModels([ctLocal("hero")], [sliceRemote("hero")]);
    expect(d.toCreate.map((e) => e.kind)).toEqual(["customtype"]);
    expect(d.remoteOnly.map((e) => e.kind)).toEqual(["slice"]);
  });

  it("ignores serializer noise via sameModel (a `select: null` is not a diff)", () => {
    const d = diffModels(
      [ctLocal("page", { f: { type: "Link" } })],
      [ctRemote("page", { f: { type: "Link", select: null } })],
    );
    expect(d.unchanged.map((e) => e.id)).toEqual(["page"]);
  });
});

describe("describeDiff", () => {
  it("names an added field inside a slice variation", () => {
    const local = {
      id: "hero",
      variations: [
        { id: "default", primary: { title: { type: "Text" }, wash: { type: "Boolean" } } },
      ],
    };
    const remote = {
      id: "hero",
      variations: [{ id: "default", primary: { title: { type: "Text" } } }],
    };
    expect(describeDiff(local, remote)).toContain("+ default.primary.wash");
  });

  it("marks a field the REMOTE has and the local does not as REMOVED remotely", () => {
    const local = { id: "hero", variations: [{ id: "default", primary: {} }] };
    const remote = {
      id: "hero",
      variations: [{ id: "default", primary: { order_uids: { type: "Text" } } }],
    };
    expect(describeDiff(local, remote)).toContain(
      "- default.primary.order_uids (REMOVED remotely)",
    );
  });

  it("marks a changed field", () => {
    const local = { id: "hero", variations: [{ id: "default", primary: { t: { type: "Text" } } }] };
    const remote = {
      id: "hero",
      variations: [{ id: "default", primary: { t: { type: "StructuredText" } } }],
    };
    expect(describeDiff(local, remote)).toContain("~ default.primary.t (changed)");
  });

  it("reports a whole new variation and a whole removed one", () => {
    const local = { id: "hero", variations: [{ id: "default" }, { id: "wide" }] };
    const remote = { id: "hero", variations: [{ id: "default" }, { id: "narrow" }] };
    const lines = describeDiff(local, remote);
    expect(lines).toContain("+ variation wide (new)");
    expect(lines).toContain("- variation narrow (REMOVED remotely)");
  });

  // Custom types carry `json: { <Tab>: { <field>: {...} } }` instead of
  // variations. Without this branch every custom-type diff rendered as an empty
  // list and the PR comment said "changed" with no detail.
  it("walks a custom type's json tabs", () => {
    const local = {
      id: "page",
      json: { Main: { title: { type: "Text" }, hero_wash: { type: "Boolean" } } },
    };
    const remote = { id: "page", json: { Main: { title: { type: "Text" } } } };
    expect(describeDiff(local, remote)).toContain("+ Main.hero_wash");
  });

  it("reports a whole new tab", () => {
    const local = { id: "page", json: { Main: {}, SEO: { og: { type: "Text" } } } };
    const remote = { id: "page", json: { Main: {} } };
    expect(describeDiff(local, remote)).toContain("+ tab SEO (new)");
  });

  it("returns [] for a model with neither variations nor json", () => {
    expect(describeDiff({ id: "x" }, { id: "x" })).toEqual([]);
  });

  it("treats a missing remote as all-new without throwing", () => {
    const local = { id: "hero", variations: [{ id: "default", primary: { t: {} } }] };
    expect(describeDiff(local, undefined)).toContain("+ variation default (new)");
  });
});
