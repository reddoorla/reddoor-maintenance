// tests/prismic/models/diff.test.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { diffModels, describeDiff } from "../../../src/prismic/models/diff.js";
import { sameModel } from "../../../src/prismic/models/canon.js";
import type { LocalEntry, PrismicModel, RemoteEntry } from "../../../src/prismic/models/types.js";

// --- Untyped navigation helpers for building/mutating test fixtures. Prismic
// models are deliberately loose (`PrismicModel` is `Record<string, unknown>`
// — see types.ts), so poking at an arbitrary nested path needs a cast
// somewhere; these three keep it to one place instead of an `any` at every
// call site.
const rec = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** Walk a dotted/indexed path through nested objects, returning the PARENT
 *  container at that path so the caller can read, assign, or `delete` the
 *  final key/index itself. */
const at = (v: unknown, ...path: Array<string | number>): Record<string, unknown> =>
  path.reduce((node: Record<string, unknown>, k) => rec(node[String(k)]), rec(v));

const readFixture = (name: string): PrismicModel =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../fixtures/prismic-models/${name}`, import.meta.url)),
      "utf-8",
    ),
  ) as PrismicModel;

// Real fleet models, copied read-only from gallerysonder and
// beachfront-dentistry (see tests/fixtures/prismic-models/). A `page` custom
// type with a `Slices` zone AND a `Group` (for Finding #3's container
// recursion), and a 3-variation slice with a non-empty `items` zone on every
// variation (round 1 never exercised `items` at all).
const pageCustomType = readFixture("gallerysonder-page-customtype.json");
const carouselSlice = readFixture("beachfront-dentistry-carousel-slice.json");

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
    const local: PrismicModel = {
      id: "hero",
      variations: [
        { id: "default", primary: { title: { type: "Text" }, wash: { type: "Boolean" } } },
      ],
    };
    const remote: PrismicModel = {
      id: "hero",
      variations: [{ id: "default", primary: { title: { type: "Text" } } }],
    };
    expect(describeDiff(local, remote)).toEqual(["+ default.primary.wash"]);
  });

  it("marks a field the REMOTE has and the local does not as Prismic-only", () => {
    const local: PrismicModel = { id: "hero", variations: [{ id: "default", primary: {} }] };
    const remote: PrismicModel = {
      id: "hero",
      variations: [{ id: "default", primary: { order_uids: { type: "Text" } } }],
    };
    expect(describeDiff(local, remote)).toEqual([
      "- default.primary.order_uids (only in Prismic — pushing DELETES it)",
    ]);
  });

  // THE WORDING IS THE WHOLE POINT OF THIS TEST, so it asserts the exact string
  // rather than a loose match.
  //
  // The old phrasing — "REMOVED remotely" — read as "the remote removed it",
  // the exact opposite of what the line means, and it inverted the operator's
  // next move. Prismic is the side that still HAS the thing; the repo is the
  // side missing it; and a push is what would delete it, taking the document
  // data with it at HTTP 200 with no warning. Read the old way, an operator goes
  // hunting for who deleted something in Prismic — when nobody did.
  //
  // This is not hypothetical: it was misread once, on live `reddoor-la` drift,
  // and only caught by going back to `compareZone` to see which argument was
  // local and which was remote. A line that needs the source read to be
  // understood is not a report.
  it("states the DIRECTION on a minus line — never that Prismic did the deleting", () => {
    const local: PrismicModel = { id: "hero", variations: [{ id: "default" }] };
    const remote: PrismicModel = { id: "hero", variations: [{ id: "default" }, { id: "rail" }] };
    const [line, ...rest] = describeDiff(local, remote);
    expect(rest).toEqual([]);
    expect(line).toBe("- variation rail (only in Prismic — pushing DELETES it)");
    expect(line).not.toMatch(/REMOVED remotely/i);
    // Names the consequence, not just the location: "only in Prismic" alone
    // still leaves "so what?" unanswered for the one reader who matters — the
    // one deciding whether to merge.
    expect(line).toMatch(/DELETES/);
  });

  it("marks a changed field", () => {
    const local: PrismicModel = {
      id: "hero",
      variations: [{ id: "default", primary: { t: { type: "Text" } } }],
    };
    const remote: PrismicModel = {
      id: "hero",
      variations: [{ id: "default", primary: { t: { type: "StructuredText" } } }],
    };
    expect(describeDiff(local, remote)).toEqual(["~ default.primary.t (changed)"]);
  });

  it("reports a whole new variation and a whole removed one", () => {
    const local: PrismicModel = { id: "hero", variations: [{ id: "default" }, { id: "wide" }] };
    const remote: PrismicModel = {
      id: "hero",
      variations: [{ id: "default" }, { id: "narrow" }],
    };
    expect(describeDiff(local, remote)).toEqual([
      "+ variation wide (new)",
      "- variation narrow (only in Prismic — pushing DELETES it)",
    ]);
  });

  // Custom types carry `json: { <Tab>: { <field>: {...} } }` instead of
  // variations. Without this branch every custom-type diff rendered as an empty
  // list and the PR comment said "changed" with no detail.
  it("walks a custom type's json tabs", () => {
    const local: PrismicModel = {
      id: "page",
      json: { Main: { title: { type: "Text" }, hero_wash: { type: "Boolean" } } },
    };
    const remote: PrismicModel = { id: "page", json: { Main: { title: { type: "Text" } } } };
    expect(describeDiff(local, remote)).toEqual(["+ Main.hero_wash"]);
  });

  it("reports a whole new tab", () => {
    const local: PrismicModel = {
      id: "page",
      json: { Main: {}, SEO: { og: { type: "Text" } } },
    };
    const remote: PrismicModel = { id: "page", json: { Main: {} } };
    expect(describeDiff(local, remote)).toEqual(["+ tab SEO (new)"]);
  });

  it("returns [] for a model with neither variations nor json", () => {
    expect(describeDiff({ id: "x" }, { id: "x" })).toEqual([]);
  });

  // Once the model-level metadata pass is skipped on an insert (see the
  // "insert noise" test below), this is a clean, fully deterministic
  // single-line result — no more incidental `+ (model) id`/etc. lines to
  // dodge, so this can pin the full array.
  it("treats a missing remote as all-new without throwing", () => {
    const local: PrismicModel = {
      id: "hero",
      variations: [{ id: "default", primary: { t: {} } }],
    };
    expect(describeDiff(local, undefined)).toEqual(["+ variation default (new)"]);
  });

  // --- Finding #4a (MINOR), insert path: on an insert EVERY key is new, so
  // itemizing the model's own top-level keys one at a time is pure noise
  // once the structural `+ tab X (new)` line already says "this is all
  // new". Verified against the real fleet: the metadata pass alone produced
  // 1,111 `+ (model) k` lines against 368 structural ones on inserts (75%
  // noise) — a custom type used to open with `+ (model) format`, `+
  // (model) id`, `+ (model) label`, `+ (model) repeatable`, `+ (model)
  // status` before the first `+ tab Main (new)`.
  it("skips model-level metadata noise entirely on an insert (remote undefined)", () => {
    const local: PrismicModel = {
      id: "page",
      label: "Page",
      format: "page",
      repeatable: true,
      status: true,
      json: { Main: {} },
    };
    expect(describeDiff(local, undefined)).toEqual(["+ tab Main (new)"]);
  });

  // --- Finding #1 (CRITICAL): a model-level or variation-level rename
  // touches NEITHER `primary`/`items` nor `json` tabs, so it rendered ZERO
  // lines even though `diffModels` correctly sorted the pair into
  // `toUpdate` — a PR comment reading "CHANGED customtype page" with
  // nothing underneath. This is the exact fixture the `diffModels` suite
  // above already builds for "puts a changed model in toUpdate" (a bare
  // `label` change) — it was constructed but never actually run through
  // `describeDiff`.
  it("names a model-level metadata change (the bare `label` diff diffModels already builds)", () => {
    const local = ctLocal("page", { label: "Page v2" }).model;
    const remote = ctRemote("page", { label: "Page" }).model;
    expect(describeDiff(local, remote)).toEqual(["~ (model) label"]);
  });

  it("names model-level keys added and removed, distinct from a `(changed)` line", () => {
    const local: PrismicModel = { id: "page", label: "Page", repeatable: true };
    const remote: PrismicModel = { id: "page", label: "Page", status: true };
    expect(describeDiff(local, remote)).toEqual([
      "+ (model) repeatable",
      "- (model) status (only in Prismic — pushing DELETES it)",
    ]);
  });

  it("names a variation-level metadata change (`name`), distinct from a field path", () => {
    const local: PrismicModel = {
      id: "hero",
      variations: [{ id: "default", name: "Default", primary: {} }],
    };
    const remote: PrismicModel = {
      id: "hero",
      variations: [{ id: "default", name: "Default (old)", primary: {} }],
    };
    expect(describeDiff(local, remote)).toEqual(["~ variation default: name"]);
  });

  // `imageUrl` is the Prismic-owned slice-preview screenshot URL — `canon()`
  // (canon.ts) already treats it as meaningless noise at ANY depth. A
  // per-key variation-metadata diff bypasses that whole-object
  // canonicalization, so without an explicit exclusion, the nine real fleet
  // repos canon.ts documents as carrying a stale on-disk `imageUrl` would
  // show a spurious line on every single push.
  it("does not report a differing imageUrl as a variation metadata change", () => {
    const local: PrismicModel = {
      id: "hero",
      variations: [{ id: "default", imageUrl: "", primary: {} }],
    };
    const remote: PrismicModel = {
      id: "hero",
      variations: [{ id: "default", imageUrl: "https://images.prismic.io/stale.png", primary: {} }],
    };
    expect(sameModel(local, remote)).toBe(true);
    expect(describeDiff(local, remote)).toEqual([]);
  });

  // --- Finding #4 (MINOR): `"constructor" in {}` is `true` via
  // `Object.prototype`, so the old `k in b` check would silently treat a
  // field literally named `constructor` as already present on a side that
  // has no OWN key by that name at all — hiding a real add/remove.
  it("does not let a field literally named 'constructor' hide behind the prototype chain", () => {
    const local: PrismicModel = {
      id: "hero",
      variations: [{ id: "default", primary: { constructor: { type: "Text" } } }],
    };
    const remote: PrismicModel = { id: "hero", variations: [{ id: "default", primary: {} }] };
    expect(describeDiff(local, remote)).toEqual(["+ default.primary.constructor"]);
    expect(describeDiff(remote, local)).toEqual([
      "- default.primary.constructor (only in Prismic — pushing DELETES it)",
    ]);
  });

  // --- Finding #5 (MINOR): the old `asZone(v).id as string` cast LIED when
  // `id` was absent. Every id-less variation on a side keyed to the literal
  // string "undefined" and collided with every OTHER id-less variation on
  // that SAME side, silently dropping all but the last one's diff.
  it("falls back to a unique, honest index label when a variation has no id", () => {
    const local: PrismicModel = { id: "hero", variations: [{ primary: { t: {} } }] };
    const remote: PrismicModel = { id: "hero", variations: [] };
    expect(describeDiff(local, remote)).toEqual(["+ variation variations[0] (new)"]);
  });

  it("keeps MULTIPLE id-less variations distinct instead of colliding into one", () => {
    const local: PrismicModel = {
      id: "hero",
      variations: [{ primary: { a: { type: "Text" } } }, { primary: { b: { type: "Text" } } }],
    };
    const remote: PrismicModel = { id: "hero", variations: [] };
    expect(describeDiff(local, remote)).toEqual([
      "+ variation variations[0] (new)",
      "+ variation variations[1] (new)",
    ]);
  });

  // --- Finding #3 (IMPORTANT), against the REAL page custom type: its
  // `Main.slices` field is a `Slices` zone with 6 real choices, and
  // `Main.sections` is a `Group` wrapping a real nested field. Before this
  // fix, removing ONE choice rendered only the opaque `~ Main.slices
  // (changed)` — a reviewer could see something changed but never WHAT (137
  // real Group/Slices containers fleet-wide, some hiding up to 28 children).
  describe("nested Group/Slices containers, against the real page custom type", () => {
    it("names the specific removed Slices choice, not the opaque container line", () => {
      // Local (the repo file) had `video_block` deleted from the choice
      // list; remote (still-live in Prismic, unmutated) still has it — the
      // exact shape of the coordinator's example ("removing the lead_text
      // choice from reddoor-starter's page slice zone").
      const local = structuredClone(pageCustomType);
      delete at(local, "json", "Main", "slices", "config", "choices").video_block;
      const lines = describeDiff(local, pageCustomType);
      expect(lines).toContain("- Main.slices.video_block (only in Prismic — pushing DELETES it)");
      expect(lines).not.toContain("~ Main.slices (changed)");
    });

    it("names the specific added Group field, not the opaque container line", () => {
      const remote = structuredClone(pageCustomType);
      delete at(remote, "json", "Main", "sections", "config", "fields").section;
      const lines = describeDiff(pageCustomType, remote);
      expect(lines).toContain("+ Main.sections.section");
      expect(lines).not.toContain("~ Main.sections (changed)");
    });

    // The fallback half of Finding #3: when the container's OWN metadata
    // changes (its `repeat` flag) but its children are byte-identical,
    // there is nothing for the recursion to find — the generic changed line
    // must still fire, or this class of edit goes silent again.
    it("falls back to the generic changed line when only the container's OWN metadata differs", () => {
      const remote = structuredClone(pageCustomType);
      at(remote, "json", "Main", "sections", "config").repeat = false;
      expect(describeDiff(pageCustomType, remote)).toEqual(["~ Main.sections (changed)"]);
    });

    // Finding #1 (IMPORTANT, second review round): the child-specific
    // report above was itself a NEW metadata blind spot one level down —
    // when the container's OWN metadata changes ALONGSIDE a child change,
    // reporting only the child line hid the destructive half. Mutating
    // both at once on every real fleet container: 155/155 reported only
    // the child line. Both must render, container line first.
    it("reports the container's OWN metadata change ALONGSIDE its child change, not instead of it", () => {
      const remote = structuredClone(pageCustomType);
      at(remote, "json", "Main", "sections", "config").repeat = false; // container's own config differs
      delete at(remote, "json", "Main", "sections", "config", "fields").section; // AND a child differs
      expect(describeDiff(pageCustomType, remote)).toEqual([
        "~ Main.sections (changed)",
        "+ Main.sections.section",
      ]);
    });
  });

  // --- `items` zone (untested in round 1): 28 real fleet variations use a
  // non-empty `items` zone, and round 1 only ever exercised `primary`.
  it("names a changed field inside a non-empty `items` zone, on the real Carousel slice", () => {
    const remote = structuredClone(carouselSlice);
    delete at(remote, "variations", 0, "items").subcaption;
    expect(describeDiff(carouselSlice, remote)).toEqual(["+ default.items.subcaption"]);
  });

  // --- Finding #2 (IMPORTANT, second review round): a THIRD metadata blind
  // spot, this one at the zone-presence level. `asZone(undefined)` is `{}`,
  // so an ABSENT `items` and an EMPTY `items: {}` are indistinguishable to
  // the zone pass — while `canon` keeps `{}` and correctly calls the models
  // different (an empty object survives canon's filter; a key that plain
  // doesn't exist has nothing to survive). Both shapes exist on disk today
  // (210/245 real fleet variations carry `items: {}`, 2 carry none), so a
  // hand edit deleting an `"items": {}` line reaches this — plausible,
  // since Prismic deprecates `items`. This is the backstop the runtime
  // invariant below closes: it doesn't special-case zone presence, it
  // guarantees NOTHING sameModel calls different can render blank, closing
  // this class and degrading any FUTURE blind spot to an honest "changed,
  // no detail" instead of a silent one.
  it("renders the backstop line when the only difference is zone PRESENCE (items: {} vs absent)", () => {
    const local: PrismicModel = {
      id: "hero",
      variations: [{ id: "default", primary: {}, items: {} }],
    };
    const remote: PrismicModel = {
      id: "hero",
      variations: [{ id: "default", primary: {} }], // no `items` key at all
    };
    expect(sameModel(local, remote)).toBe(false);
    expect(describeDiff(local, remote)).toEqual(["~ (model) changed (no field-level detail)"]);
  });

  // --- Finding #6c, the property test that would have caught Finding #1:
  // for every one of these REAL fleet models, `!sameModel(a, b)` MUST imply
  // `describeDiff(a, b).length > 0`. Each mutator here is a change
  // `sameModel` treats as real — never an `imageUrl`/serializer-noise edit,
  // which correctly does NOT need a line (see the dedicated test above).
  type Mutator = { label: string; mutate: (m: PrismicModel) => void };

  const pageMutators: Mutator[] = [
    {
      label: "field added to a tab",
      mutate: (m) => {
        at(m, "json", "Main").new_field = { type: "Text", config: { label: "new" } };
      },
    },
    {
      label: "field removed from a tab",
      mutate: (m) => {
        delete at(m, "json", "Main").title_line_three;
      },
    },
    {
      label: "field type changed",
      mutate: (m) => {
        at(m, "json", "Main", "dates").type = "StructuredText";
      },
    },
    { label: "model-level label renamed", mutate: (m) => (m.label = "Page V2") },
    { label: "model-level repeatable flipped", mutate: (m) => (m.repeatable = false) },
    { label: "model-level format changed", mutate: (m) => (m.format = "custom") },
    {
      label: "model-level status removed",
      mutate: (m) => {
        delete m.status;
      },
    },
    {
      label: "Slices choice removed",
      mutate: (m) => {
        delete at(m, "json", "Main", "slices", "config", "choices").image_gallery;
      },
    },
    {
      label: "Group field added",
      mutate: (m) => {
        at(m, "json", "Main", "sections", "config", "fields").extra = {
          type: "Text",
          config: {},
        };
      },
    },
  ];

  const carouselMutators: Mutator[] = [
    {
      label: "primary field added",
      mutate: (m) => {
        at(m, "variations", 0, "primary").extra = { type: "Text", config: {} };
      },
    },
    {
      label: "items field removed",
      mutate: (m) => {
        delete at(m, "variations", 0, "items").subcaption;
      },
    },
    {
      label: "primary field type changed",
      mutate: (m) => {
        at(m, "variations", 2, "primary", "layout").type = "Select";
      },
    },
    { label: "slice-level name renamed", mutate: (m) => (m.name = "CarouselX") },
    { label: "slice-level description changed", mutate: (m) => (m.description = "changed") },
    {
      label: "variation-level name renamed",
      mutate: (m) => {
        at(m, "variations", 0).name = "Default (renamed)";
      },
    },
    {
      label: "variation-level description changed",
      mutate: (m) => {
        at(m, "variations", 1).description = "changed";
      },
    },
    {
      label: "whole variation removed",
      mutate: (m) => {
        arr(m.variations).splice(2, 1);
      },
    },
  ];

  describe("property: a real, genuinely different model never describes as []", () => {
    it.each(pageMutators.map((m) => [m.label, m] as const))("page custom type: %s", (_l, m) => {
      const remote = structuredClone(pageCustomType);
      m.mutate(remote);
      expect(sameModel(pageCustomType, remote)).toBe(false);
      expect(describeDiff(pageCustomType, remote).length).toBeGreaterThan(0);
    });

    it.each(carouselMutators.map((m) => [m.label, m] as const))("Carousel slice: %s", (_l, m) => {
      const remote = structuredClone(carouselSlice);
      m.mutate(remote);
      expect(sameModel(carouselSlice, remote)).toBe(false);
      expect(describeDiff(carouselSlice, remote).length).toBeGreaterThan(0);
    });
  });
});
