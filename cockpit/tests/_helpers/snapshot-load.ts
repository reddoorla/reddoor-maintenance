import { load as layoutServerLoad } from "../../src/routes/+layout.server.js";
import { load as layoutLoad } from "../../src/routes/+layout.js";
import type { CockpitSnapshot } from "../../../src/dashboard/snapshot-views.js";

/** What the root layout's server load returned, and what it asked for. */
export type LayoutRun = {
  data: { email: string | null; snapshot: CockpitSnapshot };
  depends: string[];
  headers: Record<string, string>;
};

/** The root layout's server load as SvelteKit runs it: the snapshot from the
 *  store `TURSO_DATABASE_URL` names. */
export async function runLayout(email: string | null = "op@example.com"): Promise<LayoutRun> {
  const depends: string[] = [];
  const headers: Record<string, string> = {};
  const event = {
    locals: { email },
    depends: (...ids: string[]) => depends.push(...ids),
    setHeaders: (h: Record<string, string>) => Object.assign(headers, h),
  };
  const data = (await (layoutServerLoad as unknown as (e: typeof event) => Promise<unknown>)(
    event,
  )) as LayoutRun["data"];
  return { data, depends, headers };
}

/** A page's universal load on top of the layout's, as a navigation runs the
 *  pair: the server's snapshot, through the universal layout, to the page. */
export async function runPage<T>(
  pageLoad: unknown,
  href: string,
  params: Record<string, string> = {},
  layout?: LayoutRun,
): Promise<T> {
  const url = new URL(href, "https://dash.example");
  const server = layout ?? (await runLayout());
  const layoutData = (layoutLoad as unknown as (e: unknown) => unknown)({
    data: server.data,
    url,
  });
  return (await (pageLoad as (e: unknown) => Promise<T>)({
    url,
    params,
    parent: async () => layoutData,
  })) as T;
}
