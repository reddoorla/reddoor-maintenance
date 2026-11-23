<script lang="ts">
  import vchMark from "$lib/assets/icons/vch-mark-lightsvg.svg";
  import vchVideoThumb from "$lib/assets/images/homethumb.jpg?as=run";
  import ContentWidth from "$lib/components/ContentWidth/ContentWidth.svelte";
  import { isFilled } from "@prismicio/client";
  import type { ProjectDocument } from "../../../../prismicio-types.js";
  import GalleryGrid from "$lib/components/GalleryGrid.svelte";
  import ScreenWidthMedia from "$lib/components/ScreenWidth/ScreenWidthMedia.svelte";
  import { vimeoIdOr } from "$lib/hero";

  let { data } = $props();

  let viewpoortWidth = $state(1024);

  const content = $derived(data.page.data);

  const projects: ProjectDocument[] = $derived(data.projects);

  const setProjectFromId = (id: string | undefined): ProjectDocument | null => {
    if (typeof id === "undefined") return null;
    return projects.find((proj) => proj.id === id) ?? null;
  };

  // The ten gallery slots, in order. A slot is null when it is empty or its
  // project is hidden (tagged "hide", filtered out by +page.server.ts).
  const slotFields = $derived([
    content.project_one,
    content.project_two,
    content.project_three,
    content.project_four,
    content.project_five,
    content.project_six,
    content.project_seven,
    content.project_eight,
    content.project_nine,
    content.project_ten,
  ]);
  const slots: (ProjectDocument | null)[] = $derived(
    slotFields.map((field) =>
      isFilled.contentRelationship(field) ? setProjectFromId(field.id) : null,
    ),
  );
</script>

<svelte:window bind:innerWidth={viewpoortWidth} />

<ScreenWidthMedia
  darken
  vimeoId={vimeoIdOr(content.hero_vimeo_id, "1092190178")}
  field={content.hero_image}
  src={vchVideoThumb}
>
  <div class="w-full h-full flex items-center justify-center">
    <img src={vchMark} class="w-24 z-10" alt="vch logomark" />
  </div>
</ScreenWidthMedia>

<section class="py-32">
  <ContentWidth>
    <h1 class="text-dark uppercase text-center max-w-[900px]">{content.testimonial}</h1>
    <h3 class="text-dark mt-16">{content.testimonial_attribution}</h3>
    <div class="flex flex-col items-center justify-center mt-16">
      <div class="h-0 w-3 border-light border-b-[1px] -translate-x-[0.5px]"></div>
      <div class="h-20 w-0 border-r-1 -translate-x-[0.5px] border-light"></div>
      <div
        class="w-16 h-16 rounded-full border-1 border-light relative flex flex-col items-center justify-center gap-[3px]"
      >
        <div class="label text-dark translate-x-[0.5px]">01</div>
        <div class="h-[0.5px] w-full bg-light"></div>
        <div class="label text-dark translate-x-[0.5px]">V</div>
      </div>
    </div>
  </ContentWidth>
</section>
<section class="pb-32">
  <ContentWidth class="flex flex-col gap-9">
    <GalleryGrid {slots} />
  </ContentWidth>
</section>
