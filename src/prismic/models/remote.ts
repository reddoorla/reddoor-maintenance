// The Prismic Custom Types API — the capability this whole design rests on, and
// the one that was believed impossible. Proven 2026-08-12: GET /customtypes and
// GET /slices returned 200 across five fleet repositories, POST
// /customtypes/insert returned 201 on the-pinnacle, and the historical 403 that
// produced the standing "types can only push via Slice Machine" rule reproduced
// on exactly ONE stale token (gallerysonder / reddoor-la) — a property of that
// credential, not of the API.
//
// There is deliberately NO delete function in this module. The API supports
// DELETE /customtypes/{id} (verified 204, zero residue), but a stale local
// checkout must never be able to remove a live content model, and the surest
// way to guarantee that is for the capability not to exist in the code at all.
// Deleting a model is an operator action taken in the Prismic dashboard.
//
// THE RULE FOR EVERY EDIT TO THIS FILE: no failure may become an empty array.
// `remoteModels` returning [] means "this Prismic repository has no models",
// which sends every local model to `toCreate`, empties `remoteOnly` so the
// never-delete invariant guards nothing, and in --apply pushes the entire model
// set at a repository that already holds good models. An empty result is a real
// state (a brand-new repository) and must be reachable ONLY through a
// successful call that genuinely returned nothing.
//
// Every `catch` below rethrows, with ONE deliberate exception: `errorBody`
// returns a placeholder string when the response body cannot be read. It is
// named here rather than left for a reader to discover, because this paragraph
// is the rule future editors will apply and an unnamed exception reads as a
// violation. It is safe for a reason that does not generalise: it runs only on
// paths that are ALREADY throwing, so the worst it can do is degrade a message.
// A catch that can influence what this module RETURNS has no such excuse.
import type { LocalEntry, ModelKind, PrismicModel, RemoteEntry } from "./types.js";

export const CUSTOM_TYPES_API = "https://customtypes.prismic.io";

/** Types API collection path for each model kind. */
const COLLECTION: Record<ModelKind, string> = { customtype: "customtypes", slice: "slices" };

/**
 * Per-request deadline. 15 s matches the two other JSON API clients here —
 * `src/audits/netlify-deploy.ts`'s `NETLIFY_FETCH_TIMEOUT_MS` and
 * `src/github/gh-rest.ts`'s `DEPENDABOT_FETCH_TIMEOUT_MS`. It is NOT a
 * fleet-wide constant: of the nine other `AbortSignal.timeout` call sites across
 * five files, seven use 10 s (`src/audits/browser.ts` ×5,
 * `src/audits/function-health.ts`, `src/audits/form-e2e.ts`) and only those two
 * named above use 15 s. Each is set for its own workload. 15 s is chosen here
 * because a model collection is small JSON, not because 15 is the house number.
 *
 * It is here because a hung connection is the ONLY failure mode with no error
 * to propagate, so it is the only one that would sit in a fleet sweep instead of
 * failing it. `fetch` takes no deadline of its own — `RequestInit` carries a
 * `signal` and nothing else — so the only bound on an unsignalled call is
 * undici's dispatcher-level `headersTimeout`, which defaults to 300 s. That is
 * a bound, but at fleet scale it is a sweep-killer rather than a safety net.
 *
 * A timeout on a WRITE is deliberately not set tight: it leaves an ambiguous
 * state, because Prismic may have applied the change before the deadline fired.
 * That ambiguity is recoverable — the next run re-diffs and sends an `update` —
 * but it is worth not provoking.
 */
const PRISMIC_TIMEOUT_MS = 15_000;

const authHeaders = (repo: string, token: string): Record<string, string> => ({
  repository: repo,
  Authorization: `Bearer ${token}`,
});

/** The name JSON gives the value, for an error message. `typeof null` is
 *  "object", which would report a null body as an object and send an operator
 *  looking for a key that was never there. Same shape as `local.ts` /
 *  `config.ts` use for the identical question. */
const jsonTypeOf = (v: unknown): string =>
  v === null ? "null" : Array.isArray(v) ? "an array" : typeof v;

/**
 * The response body as text, for an ERROR message only.
 *
 * This is the one `catch` in the file that returns a value instead of throwing,
 * and it is safe for a reason that must survive future edits: it runs only on
 * paths that are already throwing, so the worst it can do is degrade a message.
 * It exists because `await res.text()` inline in the `new Error(...)` argument
 * would, if the body stream itself failed, reject out of the throw expression —
 * discarding the status we went to the trouble of capturing and replacing a
 * "403 on repository X" with an opaque "terminated".
 */
const errorBody = async (res: Response, limit: number): Promise<string> =>
  res.text().then(
    (t) => t.slice(0, limit),
    (e: unknown) => `<response body unreadable: ${String(e)}>`,
  );

/**
 * One fetch with a deadline attached, rethrowing with context.
 *
 * RETHROWS, never defaults — see the file header. The wrap exists because the
 * two errors that reach it name neither the repository nor the URL: undici's
 * network failure is the bare string "fetch failed", and an aborted request is
 * "The operation was aborted due to timeout". In a fleet sweep the operator's
 * first question is "which site?", and neither message answers it.
 */
async function request(
  url: string,
  init: RequestInit,
  repo: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const what = `${init.method ?? "GET"} ${url} [repository: ${repo}]`;
    // `?.` and `instanceof`, not a bare `(e as Error).message`: a rejection is
    // not guaranteed to be an Error, and reading `.name` off a thrown `null`
    // would throw a second time FROM INSIDE this catch — replacing the real
    // failure with a bare TypeError naming nothing, which is the one outcome
    // this wrapper exists to prevent.
    const detail =
      (e as Error | null | undefined)?.name === "TimeoutError"
        ? `timed out after ${timeoutMs}ms`
        : `failed: ${e instanceof Error ? e.message : String(e)}`;
    throw new Error(`${what} ${detail}`, { cause: e });
  }
}

async function getCollection(
  repo: string,
  token: string,
  kind: ModelKind,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<RemoteEntry[]> {
  const url = `${CUSTOM_TYPES_API}/${COLLECTION[kind]}`;
  const res = await request(url, { headers: authHeaders(repo, token) }, repo, fetchImpl, timeoutMs);
  if (!res.ok) {
    // EVERY non-2xx, 404 included. The plan's discrimination rule — "404 is the
    // only status that means this model does not exist" — is about the
    // SINGLE-model endpoint, which this module never calls. On a COLLECTION GET
    // a 404 means the repository or the route is not there, which is the
    // opposite of "the repository has no models": a typo'd repositoryName would
    // read as an empty Prismic and push every local model. Do not add a 404
    // branch here.
    //
    // Name the status AND the repository: the one failure mode seen in the wild
    // is a stale/wrong token, and "403" alone is what got generalised last time
    // into "the API does not allow this". The status is also attached to the
    // Error object itself (not just interpolated into the message) so a caller
    // can tell a dead token (401/403 — fix the secret) apart from a rejected
    // model (422 — fix the model) without parsing text. Same idiom used
    // elsewhere in this codebase: `Object.assign(new Error(...), { exitCode })`.
    throw Object.assign(
      new Error(`GET ${url} [repository: ${repo}] -> ${res.status} ${await errorBody(res, 200)}`),
      { status: res.status },
    );
  }
  // Read the text, then parse it — rather than `res.json()`, which conflates two
  // different failures under one message. A body that fails MID-STREAM is a
  // transport fault, not malformed JSON, and calling it a parse error sends the
  // operator to look at Prismic's response instead of the connection. Reading
  // once also means the body is never consumed twice: `res.text()` after a
  // failed `res.json()` throws on the second read and would replace the real
  // diagnosis with "Body is unusable". Same read-then-parse shape as
  // `local.ts`'s `readModel`.
  // EVERY throw from here down names the repository. The URL cannot identify
  // the site — it is the same string for all of them, because the repository
  // travels in a HEADER (see `authHeaders`) — so without this a fleet sweep
  // reports "expected an array, got null" with no way to tell which of the
  // fleet's sites produced it.
  const where = `GET ${url} [repository: ${repo}]`;
  let raw: string;
  try {
    raw = await res.text();
  } catch (e) {
    throw new Error(`${where}: ${res.status} but the body could not be read`, { cause: e });
  }
  // A 200 whose body is not JSON (an HTML error page from a proxy, a truncated
  // response) must not surface as an opaque SyntaxError with no context. Wrapped
  // with the first of the body, never caught-and-defaulted — see the
  // absent-vs-unreadable rule at the top of the plan.
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch (e) {
    // `res.status`, not a hardcoded 200: this branch is reached on ANY 2xx, and
    // a message naming a status that was not received sends an operator looking
    // for a response that never existed.
    throw new Error(
      `${where}: ${res.status} but the body did not parse as JSON: ${raw.slice(0, 200)}`,
      { cause: e },
    );
  }
  if (!Array.isArray(body)) {
    throw new Error(`${where}: expected an array, got ${jsonTypeOf(body)}`);
  }
  return body.map((m, i) => {
    // THROW, never drop. Dropping an id-less remote entry is the absent-vs-
    // unreadable collapse pointed at the remote set, and it fails in the
    // destructive direction: the local counterpart then looks like `toCreate`
    // and --apply pushes over a model Prismic already holds, while an entry with
    // no local counterpart never reaches `remoteOnly` at all — invisible to the
    // one bucket that exists to report Prismic-only models.
    //
    // The trade is deliberate: a malformed entry fails this site's whole check
    // rather than silently corrupting it. If Prismic ever returns such an
    // entry, that is a real event an operator needs to see, not one to route
    // around.
    const id = (m as { id?: unknown } | null)?.id;
    if (typeof id !== "string" || id === "") {
      throw new Error(`${where}: entry at index ${i} has no string "id"`);
    }
    return { kind, id, model: m as PrismicModel };
  });
}

/** Every model registered in one Prismic repository, both collections.
 *
 *  The two GETs are independent and run SEQUENTIALLY on purpose. `Promise.all`
 *  would halve the per-repository wall clock, but at two small JSON requests per
 *  site that is noise inside a nightly sweep that also clones and audits — and
 *  the cost is not noise: when a failure hits BOTH collections (a dead token,
 *  the case actually seen in the wild) the reported error becomes whichever
 *  request lost the race, so the same broken credential reports a different
 *  message run to run. Deterministic attribution is worth more here than the
 *  seconds. Do not "optimise" this without a measurement showing the sweep is
 *  actually bounded by it. */
export async function remoteModels(
  repo: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = PRISMIC_TIMEOUT_MS,
): Promise<RemoteEntry[]> {
  const customtypes = await getCollection(repo, token, "customtype", fetchImpl, timeoutMs);
  const slices = await getCollection(repo, token, "slice", fetchImpl, timeoutMs);
  return [...customtypes, ...slices];
}

/** Create or REPLACE one model in Prismic. `update` replaces the whole model —
 *  which is why callers must send `withRemoteScreenshots(local, remote)` rather
 *  than the raw file on disk.
 *
 *  This function has no idea whether the model differs from what Prismic holds;
 *  it sends whatever it is given. "Never send an unchanged model" is the
 *  caller's invariant (`pushModels`), enforced by diffing first. */
export async function sendModel(
  repo: string,
  token: string,
  entry: Pick<LocalEntry, "kind" | "id" | "model">,
  action: "insert" | "update",
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = PRISMIC_TIMEOUT_MS,
): Promise<void> {
  // Prismic keys the write on the id inside the BODY; `entry.id` only ever
  // reaches the error message and the push report. If the two disagreed, an
  // `update` would replace a different live model than every log line names.
  // `types.ts` says they cannot disagree — both constructors derive `id` from
  // the parsed model — but this is the point of no return, and the parameter
  // type is structural, so any caller can hand over a pair that was never built
  // by either constructor. Check it here rather than trust it.
  // `=== ""` is checked separately from the mismatch, and it is not redundant:
  // an entry with `id: ""` AND `model.id: ""` AGREES, so the mismatch test
  // alone waves it through and Prismic is sent a model with no id. `local.ts`
  // rejects an empty `model.id` on the way in for the same reason — but the
  // argument three lines up is that this parameter is structural and a caller
  // can hand-build a pair that never passed through `local.ts` at all, which
  // applies to the empty string exactly as much as to the mismatch.
  const bodyId = (entry.model as { id?: unknown }).id;
  if (typeof bodyId !== "string" || bodyId === "" || bodyId !== entry.id) {
    throw new Error(
      `refusing to ${action} ${entry.kind} "${entry.id}": the model body's id is ` +
        `${JSON.stringify(bodyId)}. Prismic writes the body's id, not the reported ` +
        `one, so this would modify the wrong model or none at all.`,
    );
  }
  const url = `${CUSTOM_TYPES_API}/${COLLECTION[entry.kind]}/${action}`;
  const res = await request(
    url,
    {
      method: "POST",
      headers: { ...authHeaders(repo, token), "Content-Type": "application/json" },
      body: JSON.stringify(entry.model),
    },
    repo,
    fetchImpl,
    timeoutMs,
  );
  if (!res.ok) {
    // Same reasoning as getCollection above: attach `status` to the Error so
    // pushModels can distinguish a dead write token from a bad model.
    throw Object.assign(
      new Error(
        `POST ${url} [${entry.kind} ${entry.id}] -> ${res.status} ${await errorBody(res, 300)}`,
      ),
      { status: res.status },
    );
  }
}
