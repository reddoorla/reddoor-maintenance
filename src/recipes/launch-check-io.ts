import type { WebsiteRow } from "../fleet/site-row.js";
import type { LaunchCheckDeps, SearchRead, StreamRead } from "./launch-check.js";
import type { PropertyRead } from "../audits/analytics.js";

const PAGE_TIMEOUT_MS = 15_000;
const READ_WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;

/**
 * The real IO behind `launch-check`. Every Google client is imported lazily:
 * they are central devDependencies, and the CLI entry must not load them at
 * start-up (`scripts/smoke-dist.mjs` refuses a dist that does).
 */
export async function defaultLaunchCheckDeps(): Promise<LaunchCheckDeps> {
  const { readGaConfig } = await import("../reports/ga/config.js");
  const { classifyPropertyError, defaultTagProbe } = await import("../audits/analytics.js");
  const cfg = readGaConfig();

  let probeTag: LaunchCheckDeps["probeTag"];
  try {
    probeTag = await defaultTagProbe();
  } catch {
    probeTag = null;
  }

  const end = new Date();
  const start = new Date(end.getTime() - READ_WINDOW_DAYS * DAY_MS);

  return {
    subjects: () => cfg?.subjects ?? null,
    readProperty: async (propertyId, subject, hostnames): Promise<PropertyRead> => {
      if (!cfg) return { ok: false, kind: "credentials", error: "no GA credentials" };
      const { fetchPeriodUsers } = await import("../reports/ga/client.js");
      try {
        const { current } = await fetchPeriodUsers(
          { propertyId, subjects: [subject], keyPath: cfg.keyPath, hostnames },
          start,
          end,
        );
        return { ok: true, users: current };
      } catch (e) {
        return { ok: false, kind: classifyPropertyError(e), error: (e as Error).message };
      }
    },
    readStreams: async (propertyId, subjects): Promise<StreamRead> => {
      if (!cfg) return { ok: false, kind: "credentials", error: "no GA credentials" };
      const { fetchWebStreamIds } = await import("../reports/ga/admin.js");
      try {
        return {
          ok: true,
          measurementIds: await fetchWebStreamIds(propertyId, subjects, cfg.keyPath),
        };
      } catch (e) {
        return { ok: false, kind: classifyPropertyError(e), error: (e as Error).message };
      }
    },
    probeTag,
    fetchPage: async (url) => {
      const res = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      });
      return { status: res.status, url: res.url, body: await res.text() };
    },
    readSearch: async (row: WebsiteRow, subject: string): Promise<SearchRead> => {
      if (!cfg) return { ok: false, kind: "credentials", error: "no Search Console credentials" };
      const { fetchSearchPresence } = await import("../reports/search/client.js");
      try {
        const v = await fetchSearchPresence(
          {
            keyPath: cfg.keyPath,
            subjects: [subject],
            property: row.searchConsoleProperty ?? undefined,
            host: row.url,
            query: row.searchQuery?.trim() || row.name,
          },
          start,
          end,
        );
        return { ok: true, propertyFound: v.propertyFound, property: v.property ?? null };
      } catch (e) {
        return { ok: false, kind: classifyPropertyError(e), error: (e as Error).message };
      }
    },
  };
}
