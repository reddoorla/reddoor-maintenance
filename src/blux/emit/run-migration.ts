import type { MigrationPlan, PlanCustomType } from "./plan.js";

/** LIVE runners for an emitted MigrationPlan. Both are creds-gated on
 *  PRISMIC_REPOSITORY_NAME + PRISMIC_WRITE_TOKEN and excluded from unit
 *  coverage — the plan they consume is fully tested. `@prismicio/*` are
 *  devDependencies loaded lazily so nothing here lands in a consumer's
 *  dependency graph or the CLI's startup path. */

function readCreds(): { repo: string; token: string } {
  const repo = process.env.PRISMIC_REPOSITORY_NAME;
  const token = process.env.PRISMIC_WRITE_TOKEN;
  if (!repo || !token) throw new Error("Set PRISMIC_REPOSITORY_NAME and PRISMIC_WRITE_TOKEN");
  return { repo, token };
}

/** Push the plan's repeatable custom types via the Custom Types API
 *  (insert, falling back to update when the type already exists). A fresh
 *  staging repo has no types, so this must run before the documents migrate. */
export async function pushCustomTypes(types: PlanCustomType[]): Promise<string[]> {
  const { repo, token } = readCreds();
  const headers = {
    repository: repo,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const pushed: string[] = [];
  for (const t of types) {
    const body = JSON.stringify(t.json);
    let res = await fetch("https://customtypes.prismic.io/customtypes/insert", {
      method: "POST",
      headers,
      body,
    });
    if (res.status === 409) {
      res = await fetch("https://customtypes.prismic.io/customtypes/update", {
        method: "POST",
        headers,
        body,
      });
    }
    if (!res.ok) throw new Error(`custom type ${t.id}: ${res.status} ${await res.text()}`);
    pushed.push(t.id);
  }
  return pushed;
}

/** Execute a MigrationPlan against the repo: createAsset every plan asset,
 *  resolve the plain-JSON markers (`__richtext_html` via htmlAsRichText,
 *  `__asset_id` via the created assets), createDocument each doc, migrate.
 *  Idempotent by uid, so partial runs resume. */
export async function runMigration(
  plan: MigrationPlan,
  log: (line: string) => void = console.log,
): Promise<void> {
  const { repo, token } = readCreds();
  const prismic = await import("@prismicio/client");
  const { htmlAsRichText } = await import("@prismicio/migrate");

  const writeClient = prismic.createWriteClient(repo, { writeToken: token });
  const migration = prismic.createMigration();

  const assetRefs = new Map<string, unknown>();
  for (const a of plan.assets) {
    const filename = a.url.split("/").pop() ?? a.id;
    assetRefs.set(a.id, migration.createAsset(a.url, filename, { alt: a.alt }));
  }

  const resolve = (v: unknown): unknown => {
    if (v && typeof v === "object") {
      if ("__richtext_html" in v) {
        return htmlAsRichText((v as { __richtext_html: string }).__richtext_html).result;
      }
      if ("__asset_id" in v) return assetRefs.get((v as { __asset_id: string }).__asset_id);
      if (Array.isArray(v)) return v.map(resolve);
      return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, resolve(val)]));
    }
    return v;
  };

  for (const doc of plan.documents) {
    migration.createDocument(
      {
        type: doc.type,
        uid: doc.uid,
        lang: "en-us",
        data: resolve(doc.data) as Record<string, unknown>,
      },
      doc.uid,
    );
  }
  await writeClient.migrate(migration, { reporter: (e) => log(e.type) });
}
