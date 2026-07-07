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
  const pushed: string[] = [];
  for (const t of types) {
    const body = JSON.stringify(t.json);
    let res = await fetch("https://customtypes.prismic.io/customtypes/insert", {
      method: "POST",
      headers,
      body,
    });
    if (res.status === 409 || res.status === 400) {
      res = await fetch("https://customtypes.prismic.io/customtypes/update", {
        method: "POST",
        headers,
        body,
      });
    }
    await expectOk(res, `custom type ${t.id}`);
    pushed.push(t.id);
  }
  return pushed;
}

async function listAssetIdsByFilename(repo: string, token: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let cursor = "";
  for (;;) {
    const res = await expectOk(
      await fetch(`https://asset-api.prismic.io/assets?limit=500${cursor}`, {
        headers: apiHeaders(repo, token),
      }),
      "asset list",
    );
    const page = (await res.json()) as {
      items: { id: string; filename: string }[];
      cursor?: string;
    };
    for (const a of page.items) map.set(a.filename, a.id);
    if (!page.cursor || !page.items.length) return map;
    cursor = `&cursor=${encodeURIComponent(page.cursor)}`;
  }
}

/** uid → document id on the target repo, for the PUT-update path. */
async function lookupDocIds(repo: string): Promise<Map<string, string>> {
  const access = process.env.PRISMIC_ACCESS_TOKEN;
  const qs = access ? `?access_token=${access}` : "";
  const api = (await (await fetch(`https://${repo}.prismic.io/api/v2${qs}`)).json()) as {
    refs: { id: string; ref: string }[];
  };
  const master = api.refs.find((r) => r.id === "master")?.ref;
  const sep = qs ? "&" : "?";
  const search = (await (
    await fetch(
      `https://${repo}.prismic.io/api/v2/documents/search${qs}${sep}ref=${master}&pageSize=100`,
    )
  ).json()) as { results: { id: string; uid: string }[] };
  return new Map(search.results.map((d) => [d.uid, d.id]));
}

export type MigrationResult = {
  assetsUploaded: number;
  assetsReused: number;
  docsCreated: number;
  docsUpdated: number;
  missingAssets: string[];
};

/** Execute a MigrationPlan: upload missing assets (reusing existing ones by
 *  filename), then create-or-update each document by uid. Documents land in a
 *  migration release the operator publishes in the dashboard. */
export async function runMigration(
  plan: MigrationPlan,
  log: (line: string) => void = console.log,
): Promise<MigrationResult> {
  const { repo, token } = readCreds();
  const existing = await listAssetIdsByFilename(repo, token);
  const assetIdByUuid = new Map<string, string>();
  let assetsUploaded = 0;
  let assetsReused = 0;

  for (const a of plan.assets) {
    const filename = a.url.split("/").pop() ?? a.id;
    const known = existing.get(filename);
    if (known) {
      assetIdByUuid.set(a.id, known);
      assetsReused++;
      continue;
    }
    const blob = await (await expectOk(await fetch(a.url), `fetch asset ${filename}`)).blob();
    const form = new FormData();
    form.append("file", blob, filename);
    if (a.alt) form.append("alt", a.alt);
    const res = await expectOk(
      await fetch("https://asset-api.prismic.io/assets", {
        method: "POST",
        headers: apiHeaders(repo, token),
        body: form,
      }),
      `upload asset ${filename}`,
    );
    const created = (await res.json()) as { id: string };
    assetIdByUuid.set(a.id, created.id);
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
    const res = await fetch("https://migration.prismic.io/documents", {
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
          `update ${doc.uid}: uid exists but not found via the Document API (set PRISMIC_ACCESS_TOKEN?)`,
        );
      }
      await expectOk(
        await fetch(`https://migration.prismic.io/documents/${id}`, {
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
  return { assetsUploaded, assetsReused, docsCreated, docsUpdated, missingAssets };
}
