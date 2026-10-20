import type { PipelineDeps } from "../../src/prospect/pipeline.js";

const offline = async (): Promise<never> => {
  throw new Error("network disabled in tests");
};

/**
 * The pipeline stages that make their own requests, each stubbed to fail as a
 * dead network does, with pacing off. Left to their defaults, `dns` and `http`
 * ran real lookups and fetches against the fixture's hostname, and `http`
 * slept 150 ms between its probes: about 2 s of every runProspectAudit call in
 * the suite, whose result then depended on the runner's DNS. `accuracy` fell
 * to the metered Anthropic API whenever ANTHROPIC_API_KEY was exported, because
 * vitest.credential-env.ts stripped PROSPECT_* but not ANTHROPIC_*. It strips
 * ANTHROPIC_* too since #1511; the stub stays so a test that sets a key itself
 * still cannot reach the API.
 *
 * `rdap` answers null rather than throwing: the default catches every error
 * and returns null, and lookupDns does not guard the call.
 */
export function offlineNetworkDeps(): Pick<
  PipelineDeps,
  "assets" | "basics" | "dns" | "http" | "accuracy"
> {
  return {
    assets: { probe: offline, delayMs: 0, sleep: async () => {} },
    basics: { probe: offline, probeAs: offline },
    dns: { resolveTxt: offline, resolveMx: offline, rdap: async () => null },
    http: { request: offline, delayMs: 0, sleep: async () => {} },
    accuracy: { run: offline, ownership: { fetchPage: async () => null } },
  };
}
