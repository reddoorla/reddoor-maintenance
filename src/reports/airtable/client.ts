import Airtable from "airtable";
import { defaultCredentialsPath } from "../../util/credentials.js";

export type AirtableConfig = {
  apiKey: string;
  baseId: string;
};

function missing(name: string): Error {
  return Object.assign(
    new Error(
      `${name} not set. Export it in your shell or put it in ${defaultCredentialsPath()} as ${name}=...`,
    ),
    { exitCode: 2 },
  );
}

export function readAirtableConfig(): AirtableConfig {
  const apiKey = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey) throw missing("AIRTABLE_PAT");
  if (!baseId) throw missing("AIRTABLE_BASE_ID");
  return { apiKey, baseId };
}

export type AirtableBase = ReturnType<typeof openBase>;

export function openBase(cfg: AirtableConfig) {
  return new Airtable({ apiKey: cfg.apiKey }).base(cfg.baseId);
}
