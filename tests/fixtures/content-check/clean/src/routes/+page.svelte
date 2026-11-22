<script lang="ts">
  // Every word, image, video ID and link a visitor sees comes from Prismic;
  // each literal here is a fallback for an empty field, in each form the
  // check recognises.
  import { PrismicImage, PrismicLink, PrismicRichText } from "@prismicio/svelte";
  import { isFilled } from "@prismicio/client";
  import heroFallback from "$lib/assets/hero.jpg?as=run";
  import { homeCopy } from "$lib/copy/home";
  import { vimeoIdOr } from "$lib/hero";
  import Hero from "$lib/components/Hero.svelte";

  let { data } = $props();
  const doc = $derived(data.page.data);
  const copy = $derived(homeCopy(data.page));
  const title = $derived(doc.meta_title || "Fixture Co. | Custom homes");
  const DEFAULT_DESCRIPTION = "Custom homes in the valley since 1998.";
  const description = $derived(doc.meta_description ?? DEFAULT_DESCRIPTION);
  const phone = $derived(isFilled.keyText(doc.phone) ? doc.phone : "(555) 010-0199");
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
</svelte:head>

<Hero
  field={doc.hero_image}
  src={heroFallback}
  vimeoId={vimeoIdOr(doc.hero_vimeo_id, "1092190178")}
/>

<h1>{copy.heading}</h1>
<h2>{copy.subheading}</h2>

{#if isFilled.richText(doc.intro)}
  <PrismicRichText field={doc.intro} />
{:else}
  <p>We build homes that last for generations.</p>
{/if}

<PrismicLink field={doc.cta_link} class="btn">{doc.cta_label || "Book a visit"}</PrismicLink>
<a href={doc.phone_link?.url ?? "tel:+15550100199"}>{phone}</a>
<a href={doc.email_link?.url ?? "mailto:hello@example.com"}>{doc.email ?? "hello@example.com"}</a>
<PrismicImage field={doc.team_photo} alt="" />

<div class="label">01</div>
<div class="label">V</div>
<span aria-hidden="true">•</span>
