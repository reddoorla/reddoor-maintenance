<script lang="ts">
  import { onMount } from "svelte";
  import {
    RF_KEY,
    RF_POLL_MS,
    RF_MAX_MS,
    RF_CONFIRM,
    workflowRows,
    readSaved,
    type FleetStatus,
    type RfRow,
  } from "./fleet-refresh.js";

  const REFRESH_URL = "/api/fleet/refresh";
  const IDLE = "↻ Audit fleet";

  let label = $state(IDLE);
  let disabled = $state(false);
  let rows: RfRow[] = $state([]);

  function stop() {
    try {
      localStorage.removeItem(RF_KEY);
    } catch {
      // storage unavailable
    }
  }

  function release() {
    disabled = false;
    label = IDLE;
  }

  function finishWith(row: RfRow) {
    rows = [...rows, row];
    release();
    stop();
  }

  function pastCeiling(startedAt: number): boolean {
    if (Date.now() - startedAt <= RF_MAX_MS) return false;
    finishWith({ kind: "text", text: "Still running — reload later." });
    return true;
  }

  function poll(since: string, startedAt: number) {
    fetch("/api/fleet/refresh/status?since=" + encodeURIComponent(since))
      .then((res) => {
        if (res.status === 401) return { authFail: true };
        return res.ok ? res.json() : null;
      })
      .then((data: { authFail?: boolean; status?: FleetStatus } | null) => {
        if (data && data.authFail) {
          finishWith({ kind: "text", text: "Session expired — reload to sign in." });
          return;
        }
        if (data && data.status) {
          rows = workflowRows(data.status, startedAt, Date.now());
          if (data.status.allDone) {
            if (!data.status.anyFailure) {
              rows = [...rows, { kind: "text", text: "✓ Done — reloading…" }];
              stop();
              setTimeout(() => location.reload(), 2000);
              return;
            }
            finishWith({ kind: "reload" });
            return;
          }
        }
        if (pastCeiling(startedAt)) return;
        setTimeout(() => poll(since, startedAt), RF_POLL_MS);
      })
      .catch(() => {
        if (pastCeiling(startedAt)) return;
        setTimeout(() => poll(since, startedAt), RF_POLL_MS);
      });
  }

  function begin(since: string, startedAt: number) {
    try {
      localStorage.setItem(RF_KEY, JSON.stringify({ since, startedAt }));
    } catch {
      // storage unavailable: the run is still followed until the page closes
    }
    rows = [{ kind: "starting" }];
    poll(since, startedAt);
  }

  async function start() {
    if (!confirm(RF_CONFIRM)) return;
    disabled = true;
    label = "Auditing…";
    try {
      const res = await fetch(REFRESH_URL, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        label = "↻ Audit running…";
        if (data && data.since) begin(data.since, Date.now());
      } else {
        label = "Failed to start";
        disabled = false;
      }
    } catch {
      label = "Failed to start";
      disabled = false;
    }
  }

  // Resume-on-reload: if a refresh is in flight (<90 min old), keep following it.
  onMount(() => {
    let saved: ReturnType<typeof readSaved> = null;
    try {
      saved = readSaved(localStorage, Date.now());
    } catch {
      // storage unavailable
    }
    if (saved) {
      disabled = true;
      label = "↻ Audit running…";
      begin(saved.since, saved.startedAt);
    }
  });
</script>

<div class="fleet-actions">
  <button
    type="button"
    class="refresh-fleet"
    data-refresh-url={REFRESH_URL}
    {disabled}
    onclick={start}>{label}</button
  >
  <div id="rf-status" class="rf-status" aria-live="polite">
    {#each rows as row, i (i)}
      {#if row.kind === "workflow"}
        <div class="rf-row">
          {#if row.icon === "done"}✓{:else if row.icon === "failed"}✗{:else}<span class="rf-spin"
            ></span>{/if}
          {row.label} — {row.state}{#if row.progress}<div class="rf-sub">
              {row.progress.elapsed}{row.progress.eta
                ? " / " + row.progress.eta
                : ""}{#if row.progress.url}{" · "}<a
                  href={row.progress.url}
                  target="_blank"
                  rel="noopener">view run ↗</a
                >{/if}
            </div>{:else if row.failedUrl}{" "}<a
              href={row.failedUrl}
              target="_blank"
              rel="noopener">run</a
            >{/if}
        </div>
      {:else if row.kind === "text"}
        <div class="rf-row">{row.text}</div>
      {:else if row.kind === "starting"}
        <div class="rf-row"><span class="rf-spin"></span> starting…</div>
      {:else}
        <div class="rf-row">
          <button type="button" onclick={() => location.reload()}>Reload</button>
        </div>
      {/if}
    {/each}
  </div>
</div>
