import { vi } from "vitest";
import type { AirtableBase } from "../../../src/reports/airtable/client.js";

export function untouchableBase(touched: string[]): AirtableBase {
  return ((table: unknown) =>
    new Proxy(
      {},
      {
        get: (_target, op) => () => {
          const contact = `Airtable touched: ${String(table)}.${String(op)}`;
          touched.push(contact);
          throw new Error(contact);
        },
      },
    )) as unknown as AirtableBase;
}

export function untouchableFetch(touched: string[]): typeof fetch {
  return vi.fn(async (input: unknown) => {
    const url = input instanceof Request ? input.url : String(input);
    const contact = `${/airtable\.com/.test(url) ? "Airtable" : "Network"} touched: fetch ${url}`;
    touched.push(contact);
    throw new Error(contact);
  }) as unknown as typeof fetch;
}
