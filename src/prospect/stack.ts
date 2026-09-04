import { usablePages } from "./pages.js";
import type { CrawlResult } from "./types.js";

/**
 * What they are running, named back to them.
 *
 * This is not a check and it must never try to be. Nothing here passes or
 * fails, nothing here enters the denominator, and no line of it belongs in the
 * fix list. It exists to answer the reader's first silent question — do these
 * people know what they are talking about — before a single finding is made.
 *
 * "You're on WordPress running the Astra theme with Elementor, your forms are
 * Gravity Forms, your DNS is at GoDaddy and your mail is Google Workspace" is a
 * sentence nobody sending a cold audit can write, and it costs us almost
 * nothing because every receipt for it is already in the crawl.
 *
 * The discipline is the same as everywhere else in this codebase, and it is the
 * whole reason `evidence` is non-optional on `StackItem`: every line is an
 * OBSERVATION WITH A RECEIPT — the exact URL or header we read it off — never
 * an inference we cannot show. A reader who disputes a line can go and look at
 * the thing we looked at.
 *
 * The failure this module must not commit is the mirror of the one the checks
 * must not commit. There, our missing measurement must not become their defect.
 * Here, our missing measurement must not become "they don't have one": a
 * WordPress site behind a caching plugin that rewrites asset paths is
 * completely invisible to this, and so is any site whose markup we never read.
 * `measured` says whether we were in a position to see anything at all, and the
 * report must be able to say "we could not tell" rather than implying absence.
 */

export type StackLayer =
  | "cms"
  | "theme"
  | "plugin"
  | "page-builder"
  | "framework"
  | "hosting"
  | "ecommerce"
  | "forms"
  | "analytics"
  | "fonts";

/** Display order in the readout. Broadest thing first — a reader wants "you're
 *  on WordPress" before "you load Hotjar". */
export const LAYER_ORDER: StackLayer[] = [
  "cms",
  "theme",
  "page-builder",
  "framework",
  "ecommerce",
  "plugin",
  "forms",
  "analytics",
  "fonts",
  "hosting",
];

export const LAYER_LABELS: Record<StackLayer, string> = {
  cms: "Platform",
  theme: "Theme",
  "page-builder": "Page builder",
  framework: "Framework",
  ecommerce: "Store",
  plugin: "Plugins",
  forms: "Forms",
  analytics: "Analytics and tracking",
  fonts: "Fonts",
  hosting: "Hosting and CDN",
};

export type StackItem = {
  layer: StackLayer;
  /** What we are naming, spelled the way its own vendor spells it. */
  name: string;
  /**
   * The receipt — the URL or response header we read it off, truncated only for
   * length. Never optional and never synthesised: a line without a receipt is
   * an assertion, and this module does not make assertions.
   */
  evidence: string;
};

export type StackReadout = {
  /**
   * Were we in a position to see anything?
   *
   * False when no page we read carried a `scriptSrcs` array — which is every
   * report stored before that field existed, and any run whose pages all failed
   * to fetch. An empty `items` with `measured: false` means "we could not
   * tell"; with `measured: true` it means "we read the markup and recognised
   * nothing in it", which is a real and unremarkable answer for a hand-built
   * site.
   */
  measured: boolean;
  items: StackItem[];
  /** How many pages' markup we actually read. The honest denominator for any
   *  sentence that starts "we did not see". */
  pagesExamined: number;
  /** Did we also read response headers? They carry the hosting and CDN half,
   *  and a run without them can say nothing about either. */
  headersExamined: boolean;
};

/** Matched against every asset URL a page references — script srcs and image
 *  srcs today, stylesheet hrefs once the `<link>` set is projected. */
type AssetSignature = { layer: StackLayer; name: string; match: RegExp };

/**
 * Deliberately narrow patterns. A signature that fires on a substring of an
 * ordinary URL puts a wrong name in front of the client on page one of the
 * report, which costs more than every correct line on the page earns — the same
 * reasoning that made `BOOKING_HOSTS` match on hostname rather than href after
 * "cal.com" credited a booking system to medical.com.
 */
const ASSET_SIGNATURES: AssetSignature[] = [
  // Platforms, by the paths only they serve.
  { layer: "cms", name: "WordPress", match: /\/wp-(?:content|includes)\// },
  { layer: "cms", name: "Squarespace", match: /(?:^|\/\/|\.)squarespace\.com\// },
  { layer: "cms", name: "Wix", match: /(?:^|\/\/|\.)wixstatic\.com\// },
  { layer: "cms", name: "Webflow", match: /(?:^|\/\/|\.)website-files\.com\// },
  { layer: "cms", name: "HubSpot CMS", match: /(?:^|\/\/|\.)(?:hs-scripts|hs-banner)\.com\// },
  { layer: "cms", name: "Duda", match: /(?:^|\/\/|\.)cdn-website\.com\// },
  { layer: "cms", name: "GoDaddy Website Builder", match: /(?:^|\/\/|\.)wsimg\.com\// },
  { layer: "cms", name: "Drupal", match: /\/(?:core|modules)\/misc\/drupal\.js/ },
  { layer: "cms", name: "Ghost", match: /\/assets\/built\/[a-z-]+\.js/ },

  // Frameworks, by their build output paths.
  { layer: "framework", name: "Next.js", match: /\/_next\/static\// },
  { layer: "framework", name: "Nuxt", match: /\/_nuxt\// },
  { layer: "framework", name: "SvelteKit", match: /\/_app\/immutable\// },
  { layer: "framework", name: "Gatsby", match: /\/page-data\/|webpack-runtime-[a-f0-9]+\.js/ },
  { layer: "framework", name: "Angular", match: /\/(?:polyfills|runtime)[.-][a-z0-9]+\.js/ },

  // Page builders. All WordPress plugins, but a reader thinks of them as the
  // thing they edit in, so they get their own layer rather than being buried
  // among thirty plugin names.
  { layer: "page-builder", name: "Elementor", match: /\/wp-content\/plugins\/elementor/ },
  { layer: "page-builder", name: "Divi", match: /\/wp-content\/themes\/[Dd]ivi\// },
  { layer: "page-builder", name: "WPBakery", match: /\/wp-content\/plugins\/js_composer\// },
  { layer: "page-builder", name: "Beaver Builder", match: /\/wp-content\/plugins\/beaver-builder/ },
  { layer: "page-builder", name: "Oxygen", match: /\/wp-content\/plugins\/oxygen\// },

  // Stores.
  { layer: "ecommerce", name: "WooCommerce", match: /\/wp-content\/plugins\/woocommerce\// },
  { layer: "ecommerce", name: "Shopify", match: /(?:^|\/\/|\.)shopify\.com\// },
  { layer: "ecommerce", name: "BigCommerce", match: /(?:^|\/\/|\.)bigcommerce\.com\// },

  // Forms. Which one matters commercially: it is the thing an enquiry actually
  // travels through, and half of these have a free tier that silently drops mail.
  { layer: "forms", name: "Gravity Forms", match: /\/plugins\/gravityforms\// },
  { layer: "forms", name: "Contact Form 7", match: /\/plugins\/contact-form-7\// },
  { layer: "forms", name: "WPForms", match: /\/plugins\/wpforms/ },
  { layer: "forms", name: "Ninja Forms", match: /\/plugins\/ninja-forms\// },
  { layer: "forms", name: "Typeform", match: /(?:^|\/\/|\.)typeform\.com\// },
  { layer: "forms", name: "Jotform", match: /(?:^|\/\/|\.)jotform\.com\// },
  { layer: "forms", name: "HubSpot Forms", match: /(?:^|\/\/|\.)hsforms\.net\// },
  { layer: "forms", name: "Formspree", match: /(?:^|\/\/|\.)formspree\.io\// },

  // Analytics and tracking. Absence of ALL of these is its own check (T0-46);
  // here we are only naming what is there.
  { layer: "analytics", name: "Google Tag Manager", match: /googletagmanager\.com\/gtm\.js/ },
  { layer: "analytics", name: "Google Analytics 4", match: /googletagmanager\.com\/gtag\/js/ },
  {
    layer: "analytics",
    name: "Google Analytics (legacy)",
    match: /google-analytics\.com\/(?:analytics|ga)\.js/,
  },
  { layer: "analytics", name: "Meta Pixel", match: /connect\.facebook\.net\// },
  { layer: "analytics", name: "LinkedIn Insight", match: /snap\.licdn\.com\// },
  { layer: "analytics", name: "Hotjar", match: /(?:static|script)\.hotjar\.com\// },
  { layer: "analytics", name: "Microsoft Clarity", match: /(?:^|\/\/|\.)clarity\.ms\// },
  { layer: "analytics", name: "Intercom", match: /(?:widget|js)\.intercom(?:cdn)?\.(?:io|com)\// },
  { layer: "analytics", name: "Drift", match: /js\.driftt\.com\// },
  { layer: "analytics", name: "Plausible", match: /plausible\.io\/js\// },
  { layer: "analytics", name: "Fathom", match: /cdn\.usefathom\.com\// },
  { layer: "analytics", name: "Segment", match: /cdn\.segment\.(?:com|io)\// },

  // Headless CMSes, by the asset and API hosts they serve from. A modern
  // agency-built site is far likelier to be one of these than to be WordPress,
  // and naming only "SvelteKit and Netlify" back to such a client says we did
  // not look very hard.
  { layer: "cms", name: "Prismic", match: /(?:^|\/\/|\.)prismic\.io\// },
  { layer: "cms", name: "Contentful", match: /(?:^|\/\/|\.)(?:ctfassets\.net|contentful\.com)\// },
  { layer: "cms", name: "Sanity", match: /(?:^|\/\/|\.)sanity\.io\// },
  { layer: "cms", name: "Storyblok", match: /(?:^|\/\/|\.)storyblok\.com\// },
  { layer: "cms", name: "DatoCMS", match: /(?:^|\/\/|\.)datocms-assets\.com\// },
  { layer: "cms", name: "Strapi", match: /(?:^|\/\/|\.)strapi\.io\// },
  { layer: "cms", name: "Craft CMS", match: /\/cpresources\// },

  // Fonts. Typekit is a script; Google Fonts arrives as a stylesheet link, so
  // it needs the `<link>` set — which is fed in above.
  { layer: "fonts", name: "Adobe Fonts (Typekit)", match: /use\.typekit\.net\// },
  { layer: "fonts", name: "Google Fonts", match: /fonts\.(?:googleapis|gstatic)\.com\// },
];

/**
 * `<meta name="generator">`, which several platforms fill in honestly and which
 * is the only signal for a few of them.
 *
 * Matched case-insensitively against the whole content string, and the receipt
 * printed is the content itself — so when it says "WordPress 6.4.2" the reader
 * sees the version we saw rather than a name we chose.
 */
const GENERATOR_SIGNATURES: { layer: StackLayer; name: string; match: RegExp }[] = [
  { layer: "cms", name: "WordPress", match: /wordpress/i },
  { layer: "cms", name: "Drupal", match: /drupal/i },
  { layer: "cms", name: "Joomla", match: /joomla/i },
  { layer: "cms", name: "Webflow", match: /webflow/i },
  { layer: "cms", name: "Squarespace", match: /squarespace/i },
  { layer: "cms", name: "Wix", match: /wix\.com/i },
  { layer: "cms", name: "Ghost", match: /ghost/i },
  { layer: "cms", name: "Shopify", match: /shopify/i },
  { layer: "page-builder", name: "Elementor", match: /elementor/i },
  { layer: "framework", name: "Hugo", match: /hugo/i },
  { layer: "framework", name: "Jekyll", match: /jekyll/i },
  { layer: "framework", name: "Gatsby", match: /gatsby/i },
  { layer: "framework", name: "Next.js", match: /next\.js/i },
];

/**
 * Response headers that name a host or CDN.
 *
 * Presence of the header is the signal for most of these — `cf-ray` exists only
 * because Cloudflare put it there — so the receipt is the header name and, when
 * it is short enough to be meaningful rather than an opaque id, its value.
 */
const HEADER_SIGNATURES: { name: string; header: string; value?: RegExp }[] = [
  { name: "Cloudflare", header: "cf-ray" },
  { name: "Netlify", header: "x-nf-request-id" },
  { name: "Vercel", header: "x-vercel-id" },
  { name: "AWS CloudFront", header: "x-amz-cf-id" },
  { name: "Fastly", header: "x-served-by" },
  { name: "GitHub Pages", header: "x-github-request-id" },
  { name: "Pantheon", header: "x-pantheon-styx-hostname" },
  { name: "WP Engine", header: "x-wpe-backend" },
  { name: "Kinsta", header: "x-kinsta-cache" },
  { name: "LiteSpeed", header: "x-litespeed-cache" },
  { name: "Wix", header: "x-wix-request-id" },
  { name: "Shopify", header: "x-shopid" },
  { name: "Squarespace", header: "x-contextid" },
  { name: "Nginx", header: "server", value: /nginx/i },
  { name: "Apache", header: "server", value: /apache/i },
  { name: "Microsoft IIS", header: "server", value: /microsoft-iis/i },
];

/** Long query strings and cache-busting hashes make a receipt unreadable
 *  without making it more convincing. */
const MAX_EVIDENCE = 120;

function receipt(url: string): string {
  return url.length <= MAX_EVIDENCE ? url : `${url.slice(0, MAX_EVIDENCE - 1)}…`;
}

/**
 * A WordPress theme or plugin slug, from the path that names it.
 *
 * The slug is the directory, so `/wp-content/plugins/gravityforms/js/form.js`
 * gives `gravityforms`. Returned as authored rather than prettified: we are
 * reporting what is on their server, and `wp-rocket` is what they will search
 * for when they go looking.
 */
function slugsFrom(urls: string[], kind: "themes" | "plugins"): Map<string, string> {
  const re = new RegExp(`/wp-content/${kind}/([^/?#]+)/`);
  const found = new Map<string, string>();
  for (const url of urls) {
    const m = re.exec(url);
    const slug = m?.[1];
    // The first URL that named it is the receipt; later ones say nothing new.
    if (slug && !found.has(slug)) found.set(slug, receipt(url));
  }
  return found;
}

export function readStack(crawl: CrawlResult): StackReadout {
  const set = usablePages(crawl.pages);
  const headers = crawl.homeHeaders ?? {};
  const headersExamined = Object.keys(headers).length > 0;

  // `scriptSrcs` is optional on PageExtract, and its absence means "not
  // measured" — every report stored before the field existed lacks it. Reading
  // it as an empty array would turn those into sites that load no scripts and
  // therefore run nothing we recognise, which is a confident wrong answer.
  const readable = set.pages.filter((p) => p.extract.scriptSrcs !== undefined);
  const measured = readable.length > 0;

  const items: StackItem[] = [];
  const seen = new Set<string>();
  const add = (layer: StackLayer, name: string, evidence: string): void => {
    const key = `${layer}::${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ layer, name, evidence });
  };

  const assetUrls: string[] = [];
  for (const { extract } of readable) {
    // Four sources, and each closes a hole the others leave.
    //
    // URLs named inside inline scripts, because a deferred loader is still a
    // tool this site runs — naming only what was fetched at crawl time leaves
    // the readout silent about every consent-gated tag.
    //
    // And `<link>` hrefs, which is where a stylesheet-delivered font lives.
    // That was noted here as our gap back when the link set was not projected;
    // it is projected now, so the gap closes.
    assetUrls.push(
      ...(extract.scriptSrcs ?? []),
      ...(extract.imageSrcs ?? []),
      ...(extract.inlineScriptUrls ?? []),
      ...(extract.links ?? []).map((l) => l.href),
    );
  }

  // Generators BEFORE assets, because the first receipt for a name is the one
  // that gets kept and these are the better receipt twice over: the generator
  // is the site declaring itself rather than us inferring from a file path, and
  // it usually carries the version — "WordPress 6.4.2" tells the reader
  // something "/wp-content/themes/astra/js/frontend.js" does not. Run the other
  // way round the version was silently discarded on every WordPress site.
  for (const { extract } of readable) {
    const generator = extract.metas?.["generator"];
    if (!generator) continue;
    for (const sig of GENERATOR_SIGNATURES) {
      if (sig.match.test(generator)) {
        add(sig.layer, sig.name, `<meta name="generator"> ${receipt(generator)}`);
      }
    }
  }

  for (const sig of ASSET_SIGNATURES) {
    const hit = assetUrls.find((url) => sig.match.test(url));
    if (hit) add(sig.layer, sig.name, receipt(hit));
  }

  for (const [slug, evidence] of slugsFrom(assetUrls, "themes")) add("theme", slug, evidence);
  for (const [slug, evidence] of slugsFrom(assetUrls, "plugins")) add("plugin", slug, evidence);

  for (const sig of HEADER_SIGNATURES) {
    const value = headers[sig.header];
    if (value === undefined) continue;
    if (sig.value && !sig.value.test(value)) continue;
    // An opaque request id proves the header was there and says nothing else,
    // so the receipt is the header name; a `server:` value is itself the
    // finding and is worth printing.
    add(
      "hosting",
      sig.name,
      sig.value ? `${sig.header}: ${receipt(value)}` : `${sig.header} header`,
    );
  }

  return {
    measured,
    items: items.sort(
      (a, b) =>
        LAYER_ORDER.indexOf(a.layer) - LAYER_ORDER.indexOf(b.layer) || a.name.localeCompare(b.name),
    ),
    pagesExamined: readable.length,
    headersExamined,
  };
}
