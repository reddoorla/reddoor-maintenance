import { describe, it, expect, vi } from "vitest";
import { triggerProspectAudit } from "../../src/dashboard/prospect-audit-trigger.js";

/**
 * #676, and the sharp edge in it.
 *
 * The audit runs via `workflow_dispatch` against a PRIVATE repo
 * (`PROSPECT_AUDIT_DISPATCH_REPO`) whose workflow file is not in this
 * repository and cannot be read or edited from here. GitHub rejects a dispatch
 * carrying an input the workflow does not declare — so unconditionally adding
 * `terms`/`questions` to every dispatch would break the run button that works
 * today, for every audit, including the ones that choose nothing.
 *
 * The contract these tests pin: when the operator chooses nothing, the payload
 * is byte-for-byte what it is today. The new keys appear only when there is
 * something to send, which is the only case where the workflow needs to have
 * been taught about them.
 */

const REPO = { repo: "reddoorla/private-audits", workflowFile: "prospect-audit.yml" };

type Dispatched = { repo: string; workflowFile: string; inputs: Record<string, string> };

function harness(over: { recent?: unknown[] } = {}) {
  const calls: Dispatched[] = [];
  const deps = {
    listRecent: vi.fn().mockResolvedValue(over.recent ?? []),
    dispatch: vi.fn(async (target: Dispatched) => {
      calls.push(target);
      return { ok: true as const };
    }),
  };
  return { deps, calls };
}

const input = {
  url: "https://prospect.example/",
  business: null,
  requestedBy: "cockpit",
  goal: "enquire",
};

describe("the dispatch carries chosen terms only when there are some", () => {
  it("sends EXACTLY today's keys when nothing was chosen", async () => {
    // The regression guard. A new key here reaches a workflow that does not
    // declare it, and GitHub refuses the whole dispatch.
    const { deps, calls } = harness();
    await triggerProspectAudit(deps, REPO, input);
    expect(Object.keys(calls[0]!.inputs).sort()).toEqual([
      "business",
      "goal",
      "requested_by",
      "url",
    ]);
  });

  it("omits the keys for empty and whitespace-only choices too", async () => {
    const { deps, calls } = harness();
    await triggerProspectAudit(deps, REPO, { ...input, terms: ["  ", ""], questions: [] });
    expect(calls[0]!.inputs).not.toHaveProperty("terms");
    expect(calls[0]!.inputs).not.toHaveProperty("questions");
  });

  it("sends the chosen terms when the operator wrote some", async () => {
    // The grant side: the feature has to actually reach the runner.
    const { deps, calls } = harness();
    await triggerProspectAudit(deps, REPO, {
      ...input,
      terms: ["flat roof repair Boise", "commercial roofing cost"],
    });
    expect(calls[0]!.inputs.terms).toBe("flat roof repair Boise\ncommercial roofing cost");
    expect(calls[0]!.inputs).not.toHaveProperty("questions");
  });

  it("sends chosen questions independently of terms", async () => {
    const { deps, calls } = harness();
    await triggerProspectAudit(deps, REPO, {
      ...input,
      questions: ["Do you service my postcode?"],
    });
    expect(calls[0]!.inputs.questions).toBe("Do you service my postcode?");
    expect(calls[0]!.inputs).not.toHaveProperty("terms");
  });

  it("drops blank lines out of a list that also has real entries", async () => {
    const { deps, calls } = harness();
    await triggerProspectAudit(deps, REPO, {
      ...input,
      terms: ["real term", "   ", "another"],
    });
    expect(calls[0]!.inputs.terms).toBe("real term\nanother");
  });
});
