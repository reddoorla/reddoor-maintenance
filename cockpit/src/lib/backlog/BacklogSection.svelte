<script lang="ts">
  import { onMount } from "svelte";
  import type { BacklogPanel } from "../../../../src/dashboard/backlog-source.js";
  import BacklogTop from "./BacklogTop.svelte";
  import { buildBacklogView, type BacklogView } from "./view.js";

  // P1-111: fetched once the page is on screen, from `GET /api/backlog`, which
  // reads the private workspace's BACKLOG.md per request.
  let { source }: { source: string } = $props();
  let view = $state<BacklogView | null>(null);

  onMount(() => {
    let live = true;
    const abort = new AbortController();
    void (async () => {
      let next: BacklogView;
      try {
        const res = await fetch(source, {
          headers: { accept: "application/json" },
          signal: abort.signal,
        });
        if (res.status === 401) {
          next = buildBacklogView(
            { kind: "unavailable", reason: "Signed out: reload the page to sign in." },
            new Date(),
          );
        } else if (!res.ok) {
          next = buildBacklogView(
            { kind: "unavailable", reason: `The backlog read failed (HTTP ${res.status}).` },
            new Date(),
          );
        } else {
          next = buildBacklogView((await res.json()) as BacklogPanel, new Date());
        }
      } catch {
        next = buildBacklogView(
          { kind: "unavailable", reason: "The backlog read failed: no answer from the cockpit." },
          new Date(),
        );
      }
      if (live) view = next;
    })();
    return () => {
      live = false;
      abort.abort();
    };
  });
</script>

<BacklogTop {view} />
