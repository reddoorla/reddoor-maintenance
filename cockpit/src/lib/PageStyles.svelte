<script lang="ts">
  // A page's stylesheets, as `<style>` in the head for as long as the page is
  // mounted. The pages share class names, so a plain `import "./page.css"`
  // would stay loaded after a client navigation away and restyle the next page;
  // this one leaves with its page, which is what lets the cockpit navigate
  // without reloading (the snapshot, maintenance#<snapshot PR>). Import each
  // sheet with `?inline` and pass them in the order they used to be imported:
  // the Shell's base sheet is rendered first, so the cascade is unchanged.
  let { sheets }: { sheets: string[] } = $props();
</script>

<svelte:head>
  {#each sheets as sheet, i (i)}
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- our own CSS, imported at build time -->
    {@html `<style data-page-style>${sheet}</style>`}
  {/each}
</svelte:head>
