import type { PipelineDeps } from "../../src/prospect/pipeline.js";

const offline = async (): Promise<never> => {
  throw new Error("network disabled in tests");
};

/**
 * The pipeline stages that make their own requests, each stubbed to fail as a
 * dead network does, with pacing off. Left to their defaults, `dns` and `http`
 * ran real lookups and fetches against the fixture's hostname, and `http`
 * slept 150 ms between its probes: about 2 s of every runProspectAudit call in
 * the suite, whose result then depended on the runner's DNS.
 */
export function offlineNetworkDeps(): Pick<PipelineDeps, "assets" | "basics" | "dns" | "http"> {
  return {
    assets: { probe: offline, delayMs: 0, sleep: async () => {} },
    basics: { probe: offline, probeAs: offline },
    dns: { resolveTxt: offline, resolveMx: offline, rdap: offline },
    http: { request: offline, delayMs: 0, sleep: async () => {} },
  };
}
