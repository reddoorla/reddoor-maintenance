// tests/prismic/models/diff.test.ts
import { describe, it, expect } from "vitest";
import { diffModels } from "../../../src/prismic/models/diff.js";
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
