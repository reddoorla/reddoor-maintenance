<script lang="ts">
  import type { ImageField } from "@prismicio/client";

  let {
    field,
    src,
    vimeoId,
    heading = "Welcome home",
  }: { field: ImageField; src: string; vimeoId: string; heading?: string } = $props();
</script>

<section class="relative h-screen w-full overflow-hidden" data-testid="hero">
  {#if field?.url}
    <img src={field.url} alt={field.alt ?? ""} class="absolute inset-0 h-full w-full object-cover" />
  {:else}
    <img {src} alt="" class="absolute inset-0 h-full w-full object-cover" />
  {/if}
  <iframe src={`https://player.vimeo.com/video/${vimeoId}?background=1`} title={heading}></iframe>
</section>
