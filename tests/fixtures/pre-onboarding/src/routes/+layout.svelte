<script lang="ts">
  let { data, children } = $props();

  let content = $state(data.page.data);
  $effect(() => {
    data;
    content = data.page.data;
  });

  $: title = content?.title ?? "Untitled";
</script>

<svelte:head>
  <title>{title}</title>
</svelte:head>

{@render children?.()}
