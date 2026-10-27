<script lang="ts">
  import type { Snippet } from "svelte";
  import { FAVICON_LINK } from "../../../src/dashboard/favicon.js";
  import { NAV_ITEMS } from "./nav.js";
  import PageStyles from "./PageStyles.svelte";
  import ThemeToggle from "./ThemeToggle.svelte";
  import tokensCss from "./tokens.css?inline";
  import baseCss from "./base.css?inline";

  let { email, path, children }: { email: string | null; path: string; children: Snippet } =
    $props();
</script>

<svelte:head>
  {@html FAVICON_LINK}
</svelte:head>
<PageStyles sheets={[tokensCss, baseCss]} />

<header data-shell>
  <!-- No identity under the shared-password fallback: "signed in as cockpit"
       would dress an anonymous shared credential up as a person. -->
  <div class="shell-account">
    {#if email}
      <span>{email} · <a href="/auth/logout">sign out</a></span>
    {/if}
    <ThemeToggle />
  </div>
  <nav class="shell-nav" aria-label="Cockpit pages">
    {#each NAV_ITEMS as item (item.href)}
      <a href={item.href} aria-current={item.match(path) ? "page" : undefined}>{item.label}</a>
    {/each}
  </nav>
</header>

{@render children()}
