import Airtable from "airtable";

export type AirtableConfig = {
  apiKey: string;
  baseId: string;
};

export function readAirtableConfig(): AirtableConfig {
  const apiKey = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey) throw Object.assign(new Error("AIRTABLE_PAT not set"), { exitCode: 2 });
  if (!baseId) throw Object.assign(new Error("AIRTABLE_BASE_ID not set"), { exitCode: 2 });
  return { apiKey, baseId };
}

export type AirtableBase = ReturnType<typeof openBase>;

export function openBase(cfg: AirtableConfig) {
  return new Airtable({ apiKey: cfg.apiKey }).base(cfg.baseId);
}
