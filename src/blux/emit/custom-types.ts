import type { CollectionIR, FieldDef } from "../ir.js";
import type { PlanCustomType } from "./plan.js";

const FIELD_CONFIG: Record<
  FieldDef["type"],
  () => { type: string; config: Record<string, unknown> }
> = {
  text: () => ({ type: "Text", config: {} }),
  richtext: () => ({
    type: "StructuredText",
    config: { multi: "paragraph,strong,em,hyperlink,list-item,o-list-item" },
  }),
  image: () => ({ type: "Image", config: { constraint: {}, thumbnails: [] } }),
  group: () => ({ type: "Group", config: { fields: { value: { type: "Text", config: {} } } } }),
  date: () => ({ type: "Date", config: {} }),
  boolean: () => ({ type: "Boolean", config: {} }),
  number: () => ({ type: "Number", config: {} }),
  link: () => ({ type: "Link", config: { allowTargetBlank: true } }),
};

export function buildCustomType(c: CollectionIR): PlanCustomType {
  const Main: Record<string, unknown> = {};
  for (const f of c.fields) {
    const spec = FIELD_CONFIG[f.type]();
    Main[f.key] = { ...spec, config: { ...spec.config, label: f.key } };
  }
  return {
    id: c.apiId,
    label: c.label,
    repeatable: true,
    json: { id: c.apiId, label: c.label, repeatable: true, status: true, json: { Main } },
  };
}
