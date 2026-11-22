<script lang="ts">
  // One hard-coded literal (at least) of every kind the census counted.
  import hero from "$lib/assets/hero.jpg";
  import Video from "$lib/components/Video.svelte";

  const team = [{ name: "Jane Doe", bio: "Jane has built homes in the valley for twenty years." }];
  const testimonials = [{ quote: "They built our dream home.", attribution: "Sam and Alex" }];
</script>

<svelte:head>
  <title>Fixture Co. | Custom homes</title>
  <meta name="description" content="Custom homes in the valley since 1998." />
</svelte:head>

<h1>Homes built to last</h1>
<p>We build homes that last for generations.</p>
<button type="button">Book a visit</button>
<img src={hero} alt="A finished kitchen" />
<img src="/images/porch.webp" alt="" />
<Video vimeoId="1092190178" poster="/video/poster.jpg" />
<a href="/contact">Contact us</a>
<a href="tel:+15550100199">(555) 010-0199</a>
<a href="mailto:hello@example.com">hello@example.com</a>
<p>1234 Main Street, Suite 5</p>
<p>Mon–Fri, 8am to 5pm</p>
{#each testimonials as t}
  <blockquote>{t.quote}</blockquote>
{/each}
{#each team as member}
  <h3>{member.name}</h3>
  <p>{member.bio}</p>
{/each}
<a href="https://www.instagram.com/fixtureco/">Follow along</a>
