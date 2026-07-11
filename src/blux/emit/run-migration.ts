import type { MigrationPlan, PlanCustomType } from "./plan.js";
import { resolveDocData } from "./resolve-doc.js";

/** LIVE runner on the raw Prismic APIs. Learned from the Pointe run
 *  (2026-07-06): the js client's migrate() creates docs hollow, PATCHes data
 *  in a later pass, swallows validation `details[]`, re-uploads every asset on
 *  retry, and cannot update existing docs. This runner: skips assets already
 *  in the library (by filename), POSTs documents and falls back to PUT when
 *  the uid exists (id looked up via the Document API), and surfaces full error
 *  bodies. Creds: PRISMIC_REPOSITORY_NAME + PRISMIC_WRITE_TOKEN (+ optional
 *  PRISMIC_ACCESS_TOKEN when the repo's Document API is private).
 *  Live I/O — excluded from unit coverage; resolveDocData carries the tested
 *  pure logic and Plan 4 Task 10 is the live acceptance run. */

const THROTTLE_MS = 1200; // migration API limit ~1 req/s
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch with backoff on 429 — the Asset/Migration APIs rate-limit hard and a
 *  single 429 must not abort a minutes-long migration. */
async function fetchWithRetry(url: string, init?: RequestInit, tries = 4): Promise<Response> {
  for (let i = 0; ; i++) {
    const res = await fetch(url, init);
    if (res.status !== 429 || i >= tries - 1) return res;
    await sleep(1500 * (i + 1));
  }
}

function readCreds(): { repo: string; token: string } {
  const repo = process.env.PRISMIC_REPOSITORY_NAME;
  const token = process.env.PRISMIC_WRITE_TOKEN;
  if (!repo || !token) throw new Error("Set PRISMIC_REPOSITORY_NAME and PRISMIC_WRITE_TOKEN");
  return { repo, token };
}

const apiHeaders = (repo: string, token: string) => ({
  repository: repo,
  Authorization: `Bearer ${token}`,
});

async function expectOk(res: Response, what: string): Promise<Response> {
  if (res.ok) return res;
  throw new Error(`${what}: ${res.status} ${await res.text()}`);
}

/** Push the plan's repeatable custom types via the Custom Types API
 *  (insert, falling back to update when the type already exists). */
export async function pushCustomTypes(types: PlanCustomType[]): Promise<string[]> {
  const { repo, token } = readCreds();
  const headers = { ...apiHeaders(repo, token), "Content-Type": "application/json" };
  const post = (path: "insert" | "update", body: string) =>
    fetchWithRetry(`https://customtypes.prismic.io/customtypes/${path}`, {
      method: "POST",
      headers,
      body,
    });
  const pushed: string[] = [];
  for (const t of types) {
    const body = JSON.stringify(t.json);
    const ins = await post("insert", body);
    if (!ins.ok) {
      const insErr = `insert ${ins.status} ${await ins.text()}`;
      // 409/400 usually means "type exists" — but keep the insert body: when
      // the update ALSO fails, the insert's validation detail is the real clue
      if (ins.status !== 409 && ins.status !== 400)
        throw new Error(`custom type ${t.id}: ${insErr}`);
      const upd = await post("update", body);
      if (!upd.ok) {
        throw new Error(`custom type ${t.id}: ${insErr}; update ${upd.status} ${await upd.text()}`);
      }
    }
    pushed.push(t.id);
  }
  return pushed;
}

/** filename → { id, url } for every asset already in the media library. `url`
 *  is the servable CDN url (the Asset API asset object's `url` field, e.g.
 *  https://images.prismic.io/...) that the render side loads. */
async function listAssetsByFilename(
  repo: string,
  token: string,
): Promise<Map<string, { id: string; url: string }>> {
  const map = new Map<string, { id: string; url: string }>();
  let cursor = "";
  for (;;) {
    const res = await expectOk(
      await fetchWithRetry(`https://asset-api.prismic.io/assets?limit=500${cursor}`, {
        headers: apiHeaders(repo, token),
      }),
      "asset list",
    );
    const page = (await res.json()) as {
      items: { id: string; filename: string; url: string }[];
      cursor?: string;
    };
    for (const a of page.items) map.set(a.filename, { id: a.id, url: a.url });
    if (!page.cursor || !page.items.length) return map;
    cursor = `&cursor=${encodeURIComponent(page.cursor)}`;
  }
}

/** uid → document id on the target repo, for the PUT-update path. Reads the
 *  MASTER ref, so it only sees PUBLISHED documents — docs sitting in an
 *  unpublished migration release are invisible here (the miss error explains
 *  that). Follows next_page so >100-doc repos resolve fully. */
async function lookupDocIds(repo: string): Promise<Map<string, string>> {
  const access = process.env.PRISMIC_ACCESS_TOKEN;
  const qs = access ? `?access_token=${access}` : "";
  const apiRes = await expectOk(
    await fetchWithRetry(`https://${repo}.prismic.io/api/v2${qs}`),
    "Document API /api/v2 (set PRISMIC_ACCESS_TOKEN for a private repo)",
  );
  const api = (await apiRes.json()) as { refs?: { id: string; ref: string }[] };
  const master = api.refs?.find((r) => r.id === "master")?.ref;
  if (!master) throw new Error(`Document API for ${repo} returned no master ref`);

  const map = new Map<string, string>();
  const sep = qs ? "&" : "?";
  let url: string | null =
    `https://${repo}.prismic.io/api/v2/documents/search${qs}${sep}ref=${master}&pageSize=100`;
  while (url) {
    const res = await expectOk(await fetchWithRetry(url), "Document API search");
    const page = (await res.json()) as {
      results: { id: string; uid: string | null }[];
      next_page: string | null;
    };
    for (const d of page.results) if (d.uid) map.set(d.uid, d.id);
    url = page.next_page;
  }
  return map;
}

export type MigrationResult = {
  assetsUploaded: number;
  assetsReused: number;
  docsCreated: number;
  docsUpdated: number;
  missingAssets: string[];
  /** cdn url (the manifest/plan-asset url) → resolved Prismic servable url, for
   *  every asset uploaded or reused. Lets the caller rewrite the render manifest
   *  onto durable Prismic-hosted media. */
  assetUrlByCdn: Map<string, string>;
};

/** Execute a MigrationPlan: upload missing assets (reusing existing ones by
 *  filename), then create-or-update each document by uid. Documents land in a
 *  migration release the operator publishes in the dashboard. */
export async function runMigration(
  plan: MigrationPlan,
  log: (line: string) => void = console.log,
): Promise<MigrationResult> {
  const { repo, token } = readCreds();
  const existing = await listAssetsByFilename(repo, token);
  const assetIdByUuid = new Map<string, string>();
  const assetUrlByCdn = new Map<string, string>();
  let assetsUploaded = 0;
  let assetsReused = 0;

  for (const a of plan.assets) {
    // Blux filenames are `<uuid>.<ext>` — globally unique, so filename keying
    // is a sound dedup. Reused assets keep their existing alt (trade-off:
    // alt from the plan is only applied on first upload).
    const filename = (a.url.split("/").pop() ?? a.id).split("?")[0]!;
    const known = existing.get(filename);
    if (known) {
      assetIdByUuid.set(a.id, known.id);
      assetUrlByCdn.set(a.url, known.url);
      assetsReused++;
      continue;
    }
    const blob = await (await expectOk(await fetch(a.url), `fetch asset ${filename}`)).blob();
    const form = new FormData();
    form.append("file", blob, filename);
    if (a.alt) form.append("alt", a.alt);
    const res = await expectOk(
      await fetchWithRetry("https://asset-api.prismic.io/assets", {
        method: "POST",
        headers: apiHeaders(repo, token),
        body: form,
      }),
      `upload asset ${filename}`,
    );
    const created = (await res.json()) as { id: string; url: string };
    assetIdByUuid.set(a.id, created.id);
    assetUrlByCdn.set(a.url, created.url);
    assetsUploaded++;
    log(`asset ${assetsUploaded + assetsReused}/${plan.assets.length} ${filename}`);
    await sleep(THROTTLE_MS);
  }

  let docIds: Map<string, string> | null = null;
  let docsCreated = 0;
  let docsUpdated = 0;
  const missingAssets: string[] = [];

  for (const doc of plan.documents) {
    const { data, missingAssets: miss } = resolveDocData(doc.data, assetIdByUuid);
    missingAssets.push(...miss);
    const body = JSON.stringify({
      type: doc.type,
      uid: doc.uid,
      lang: "en-us",
      title: doc.uid,
      data,
    });
    const headers = { ...apiHeaders(repo, token), "Content-Type": "application/json" };
    const res = await fetchWithRetry("https://migration.prismic.io/documents", {
      method: "POST",
      headers,
      body,
    });
    if (res.ok) {
      docsCreated++;
      log(`created ${doc.uid}`);
    } else {
      const text = await res.text();
      if (!/already exists/i.test(text)) {
        throw new Error(`create ${doc.uid}: ${res.status} ${text}`);
      }
      docIds ??= await lookupDocIds(repo);
      const id = docIds.get(doc.uid);
      if (!id) {
        throw new Error(
          `update ${doc.uid}: the uid exists but is not visible on the master ref — ` +
            `most likely it sits in an UNPUBLISHED migration release; publish the release ` +
            `in the Prismic dashboard, then re-run to update` +
            (process.env.PRISMIC_ACCESS_TOKEN
              ? ""
              : " (if the repo's Document API is private, also set PRISMIC_ACCESS_TOKEN)"),
        );
      }
      await sleep(THROTTLE_MS); // the failed POST already hit the migration API
      await expectOk(
        await fetchWithRetry(`https://migration.prismic.io/documents/${id}`, {
          method: "PUT",
          headers,
          body,
        }),
        `update ${doc.uid}`,
      );
      docsUpdated++;
      log(`updated ${doc.uid}`);
    }
    await sleep(THROTTLE_MS);
  }
  return { assetsUploaded, assetsReused, docsCreated, docsUpdated, missingAssets, assetUrlByCdn };
}
