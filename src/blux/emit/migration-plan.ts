import type { SiteIR, RecordIR } from "../ir.js";
import { richText, assetRef, type MigrationPlan, type PlanDocument } from "./plan.js";
import { buildCustomType } from "./custom-types.js";
import { sectionToSlice } from "./slices.js";

const RICHTEXT = new Set(["body", "description"]);

function recordData(rec: RecordIR): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rec.values)) {
    if (
      value &&
      typeof value === "object" &&
      typeof (value as { media?: string }).media === "string"
    ) {
      data[key] = assetRef((value as { media: string }).media);
    } else if (RICHTEXT.has(key) && typeof value === "string") {
      data[key] = richText(value);
    } else {
      data[key] = value;
    }
  }
  return data;
}

export function buildMigrationPlan(ir: SiteIR): MigrationPlan {
  const customTypes = ir.collections.map(buildCustomType);

  const documents: PlanDocument[] = [];
  for (const page of ir.pages) {
    documents.push({
      type: "page",
      uid: page.uid,
      data: { title: page.title, slices: page.sections.map(sectionToSlice) },
    });
  }
  for (const c of ir.collections) {
    for (const rec of c.records) {
      documents.push({ type: c.apiId, uid: rec.uid, data: recordData(rec) });
    }
  }

  const assets = ir.assets
    .filter((a) => a.sourceUrl !== null)
    .map((a) => ({ id: a.id, url: a.sourceUrl as string, alt: a.alt }));

  return { customTypes, documents, assets };
}
