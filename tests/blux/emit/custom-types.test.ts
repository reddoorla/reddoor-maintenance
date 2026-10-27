import { describe, it, expect } from "vitest";
import { buildCustomType } from "../../../src/blux/emit/custom-types.js";

describe("buildCustomType", () => {
  const ct = buildCustomType({
    apiId: "team_member",
    label: "Team",
    publishRoute: "team",
    fields: [
      { key: "title", type: "text" },
      { key: "body", type: "richtext" },
      { key: "media", type: "image" },
      { key: "tags", type: "group" },
    ],
    records: [],
  });
  it("produces a repeatable custom type with a field per FieldDef", () => {
    expect(ct.id).toBe("team_member");
    expect(ct.repeatable).toBe(true);
    const json = ct.json as { json: { Main: Record<string, { type: string }> } };
    expect(json.json.Main.title!.type).toBe("Text");
    expect(json.json.Main.body!.type).toBe("StructuredText");
    expect(json.json.Main.media!.type).toBe("Image");
    expect(json.json.Main.tags!.type).toBe("Group");
  });
});
