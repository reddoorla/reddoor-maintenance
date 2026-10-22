import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import AuditFleet from "../../src/lib/cockpit/AuditFleet.svelte";
import { RF_KEY, RF_POLL_MS } from "../../src/lib/cockpit/fleet-refresh.js";

/**
 * The fleet-audit panel follows a running audit by polling its status. Since the
 * cockpit navigates in the browser and mounts each page afresh on navigation,
 * the panel can unmount mid-audit: its poll must stop with it, or it doubles up
 * with the next panel's and, once the audit is done, reloads whatever page the
 * operator moved on to.
 */

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("AuditFleet, unmounted mid-audit", () => {
  it("stops polling, and never reloads the page", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    localStorage.setItem(
      RF_KEY,
      JSON.stringify({ since: new Date(now - 60_000).toISOString(), startedAt: now - 60_000 }),
    );
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: { allDone: false, anyFailure: false, runs: [] } })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const reload = vi.fn();
    vi.stubGlobal("location", { ...location, reload });

    const target = document.createElement("div");
    const app = mount(AuditFleet, { target, props: {} });
    flushSync();
    await vi.advanceTimersByTimeAsync(0);
    const before = fetchMock.mock.calls.length;
    expect(before).toBeGreaterThan(0);

    // Positive control: mounted, it goes on polling.
    await vi.advanceTimersByTimeAsync(RF_POLL_MS);
    const whileMounted = fetchMock.mock.calls.length;
    expect(whileMounted).toBeGreaterThan(before);

    unmount(app);
    // The audit finishes after the panel has gone.
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ status: { allDone: true, anyFailure: false, runs: [] } })),
    );
    await vi.advanceTimersByTimeAsync(RF_POLL_MS * 5);
    expect(fetchMock.mock.calls.length).toBe(whileMounted);
    expect(reload).not.toHaveBeenCalled();
  });
});
