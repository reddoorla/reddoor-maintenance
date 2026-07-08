/** Relative path inside a site where the /health endpoint lives. Deploys as a
 * Netlify function (adapter-netlify v6); the function-health audit fetches it. */
export const HEALTH_ENDPOINT_RELATIVE = "src/routes/health/+server.ts";

/** Resilient /health for existing sites. Unlike the starter's, it does NOT
 * statically import { createClient, isPlaceholderRepo } from "$lib/prismicio" —
 * older clones lack `isPlaceholderRepo`, and a missing named import breaks the
 * Vite build. Instead it namespace-imports and feature-detects: `createClient`
 * is universal to Prismic SvelteKit sites; a missing one => prismic:"skipped"
 * (the gate treats CMS as "never ran" and keeps blocking — never a false green).
 * Any probe error => "error" (reds CMS, fail-safe). The gate keys off ok + prismic. */
export const HEALTH_ENDPOINT_TEMPLATE = `import { json } from "@sveltejs/kit";
import { env as privateEnv } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import * as prismicio from "$lib/prismicio";
import type { RequestHandler } from "./$types";

// A live probe — must never be prerendered.
export const prerender = false;

type PrismicHealth = "ok" | "error" | "skipped";

type PrismicClient = { getRepository: () => Promise<unknown> };
type PrismicModule = {
  createClient?: (opts: { fetch: typeof globalThis.fetch }) => PrismicClient;
  isPlaceholderRepo?: boolean;
};

// Server-side Prismic reachability probe. Hits the PUBLIC repository-metadata
// endpoint (getRepository — no token), time-boxed, returning ONLY a status
// string; the repository body is never included (/health is public).
async function probePrismic(fetch: typeof globalThis.fetch): Promise<PrismicHealth> {
  const mod = prismicio as PrismicModule;
  const isPlaceholder = mod.isPlaceholderRepo ?? false;
  if (isPlaceholder || typeof mod.createClient !== "function") return "skipped";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const client = mod.createClient({ fetch });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("prismic health probe timed out")), 5000);
    });
    await Promise.race([client.getRepository(), timeout]);
    return "ok";
  } catch {
    return "error";
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const GET: RequestHandler = async ({ fetch }) => {
  const prismic = await probePrismic(fetch);
  const forms = {
    ingestUrl: !!privateEnv.FORMS_INGEST_URL,
    ingestToken: !!privateEnv.FORMS_INGEST_TOKEN,
    turnstile: !!publicEnv.PUBLIC_TURNSTILE_SITE_KEY?.trim(),
  };
  // We're inside the handler, so the function ran; ok is false only when the
  // Prismic probe actively errored.
  const ok = prismic !== "error";
  return json({ ok, prismic, forms });
};
`;

/** Prismic-free /health for sites WITHOUT a `$lib/prismicio` module (non-Prismic
 * sites, e.g. a static/bespoke build). Feature-detection can survive a missing
 * *export*, but a static `import * as prismicio from "$lib/prismicio"` fails the
 * Vite build when the *module* doesn't exist — so those sites need a variant with
 * no import at all. CMS is reported as a constant "skipped" (the gate treats it as
 * "never ran" and never false-greens it). Same JSON shape as the Prismic template
 * (ok/prismic/forms) so the function-health audit parses both identically. */
export const HEALTH_ENDPOINT_TEMPLATE_NO_PRISMIC = `import { json } from "@sveltejs/kit";
import { env as privateEnv } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import type { RequestHandler } from "./$types";

// A live probe — must never be prerendered.
export const prerender = false;

export const GET: RequestHandler = async () => {
  // This site has no $lib/prismicio module, so there is no CMS to probe: report
  // "skipped" (the gate treats CMS as "never ran", never a false green).
  const prismic = "skipped" as const;
  const forms = {
    ingestUrl: !!privateEnv.FORMS_INGEST_URL,
    ingestToken: !!privateEnv.FORMS_INGEST_TOKEN,
    turnstile: !!publicEnv.PUBLIC_TURNSTILE_SITE_KEY?.trim(),
  };
  // We're inside the handler, so the function ran.
  const ok = true;
  return json({ ok, prismic, forms });
};
`;
