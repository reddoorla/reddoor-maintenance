<script lang="ts">
  import type { Snippet } from "svelte";
  import { FAVICON_LINK } from "../../../src/dashboard/favicon.js";
  import { NAV_ITEMS } from "./nav.js";
  import "./base.css";

  let { email, path, children }: { email: string | null; path: string; children: Snippet } =
    $props();
</script>

<svelte:head>
  {@html FAVICON_LINK}
</svelte:head>

<header data-shell>
  <!-- No identity under the shared-password fallback: "signed in as cockpit"
       would dress an anonymous shared credential up as a person. -->
  {#if email}
    <div style="float:right;font-size:0.8rem;color:#666">
      {email} · <a href="/auth/logout">sign out</a>
    </div>
  {/if}
  <nav class="shell-nav" aria-label="Cockpit pages">
    {#each NAV_ITEMS as item (item.href)}
      <a href={item.href} aria-current={item.match(path) ? "page" : undefined}>{item.label}</a>
    {/each}
  </nav>
</header>

{@render children()}
