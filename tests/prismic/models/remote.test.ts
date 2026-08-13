import { describe, it, expect, vi } from "vitest";
import { CUSTOM_TYPES_API, remoteModels, sendModel } from "../../../src/prismic/models/remote.js";

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/**
 * The message of a rejection, so a test can assert that several things appear
 * in it without pinning the ORDER they appear in. `rejects.toThrow(/a.*b/s)`
 * silently also asserts "a comes before b", which is not what any of these
 * tests mean and is a false red the first time someone rewords a message.
 *
 * It re-throws when the promise RESOLVES, which is load-bearing here: the whole
 * risk in this module is a failure quietly becoming a value, so a test that
 * expected a rejection must fail loudly on a resolution rather than skip its
 * assertions.
 */
const messageOf = async (p: Promise<unknown>): Promise<string> => {
  let value: unknown;
  try {
    value = await p;
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error(`expected a rejection, but it resolved with ${JSON.stringify(value)}`);
};

/** A fetch that never settles on its own and rejects only when its signal
 *  aborts — i.e. exactly what a real hung connection does to `fetch`. Used to
 *  prove the request deadline is armed AND that firing it throws. */
const hangsUntilAborted = () =>
  vi.fn(
    (_url: string | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject((init.signal as AbortSignal).reason);
        });
      }),
  );

describe("remoteModels", () => {
  it("GETs both collections and tags each entry with its kind", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) =>
      String(url).endsWith("/customtypes")
        ? ok([{ id: "page", label: "Page" }])
        : ok([{ id: "hero", type: "SharedSlice" }]),
    );
    const models = await remoteModels("espada", "tok", fetchImpl as unknown as typeof fetch);
    expect(models.map((m) => `${m.kind}:${m.id}`).sort()).toEqual([
      "customtype:page",
      "slice:hero",
    ]);
  });

  it("sends the repository header and a bearer token, never a query string", async () => {
    // The parameters are declared even though the fake ignores them: without
    // them `vi.fn` infers a zero-argument call signature, `mock.calls[0]` is
    // typed `[]`, and the cast below is a type ERROR that `vitest run` cannot
    // see — it executes the file without typechecking it, so this compiles
    // nowhere and passes anyway. Same for the two sendModel fakes below.
    const fetchImpl = vi.fn(async (_url: string | URL, _init?: RequestInit) => ok([]));
    await remoteModels("espada", "tok", fetchImpl as unknown as typeof fetch);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${CUSTOM_TYPES_API}/customtypes`);
    expect((init.headers as Record<string, string>).repository).toBe("espada");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  // The positive counterpart of every throw below. An empty remote set is a
  // REAL state — a brand-new Prismic repository — and this pins the one route
  // by which it may be reached: two successful calls that genuinely returned
  // nothing. Every other route to [] is a bug, and the tests below are what
  // keep it that way.
  it("returns [] only when both collections succeeded and were genuinely empty", async () => {
    const fetchImpl = vi.fn(async () => ok([]));
    await expect(
      remoteModels("espada", "tok", fetchImpl as unknown as typeof fetch),
    ).resolves.toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  // The historical 403 that produced the "types can only push via Slice Machine"
  // rule was ONE stale token, not the API. The message has to say which, or the
  // next person re-derives the wrong conclusion.
  it("throws a message naming the status and repository on a 403", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("explicit deny in an identity-based policy", { status: 403 }),
    );
    const message = await messageOf(
      remoteModels("gallerysonder", "stale", fetchImpl as unknown as typeof fetch),
    );
    expect(message).toMatch(/403/);
    expect(message).toMatch(/gallerysonder/);
    expect(message).toMatch(/explicit deny/);
  });

  // The plan's discrimination rule says "404 is the only status that means this
  // model does not exist" — and that sentence is about the SINGLE-model
  // endpoint, which this module never calls. On a COLLECTION GET a 404 means
  // the repository (or the route) is not there, which is the opposite of "the
  // repository has no models". This test exists because the misapplication is
  // one plausible-looking line — `if (res.status === 404) return []` — and it
  // would make a typo'd repositoryName push the entire model set at whatever
  // repository the token does reach.
  it("throws on a 404 from a collection — a missing repository is not an empty one", async () => {
    const fetchImpl = vi.fn(async () => new Response("not found", { status: 404 }));
    const message = await messageOf(
      remoteModels("typo-repo", "tok", fetchImpl as unknown as typeof fetch),
    );
    expect(message).toMatch(/404/);
    expect(message).toMatch(/typo-repo/);
  });

  it("throws when the body is not an array", async () => {
    const fetchImpl = vi.fn(async () => ok({ notAnArray: true }));
    await expect(
      remoteModels("espada", "tok", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/expected an array/);
  });

  // An earlier draft SKIPPED an id-less remote entry. That is the absent-vs-
  // unreadable collapse on the remote side, and it is the dangerous direction:
  // a dropped remote entry makes its local counterpart look like `toCreate`, so
  // `--apply` pushes over a model that already exists, and a dropped entry with
  // no local counterpart never reaches `remoteOnly` — it becomes invisible to
  // the one bucket whose entire job is to report what only exists in Prismic.
  it("THROWS on a remote entry with no string id rather than dropping it", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) =>
      String(url).endsWith("/customtypes") ? ok([{ label: "no id" }, { id: "page" }]) : ok([]),
    );
    await expect(
      remoteModels("espada", "tok", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/no string "id"/);
  });

  // The tests below exist to stop anyone adding a catch. None of these failures
  // can be allowed to become an empty array: `remoteModels` returning [] means
  // "this Prismic repository has no models", which sends every local model to
  // `toCreate` and, in --apply, pushes the whole model set at a live repository.
  // An expired token is the likely real-world trigger and Prismic's token expiry
  // is undocumented.
  it("propagates a network-level fetch rejection (never returns [])", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(
      remoteModels("espada", "tok", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/fetch failed/);
  });

  it("throws when a 200 body is not JSON at all", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("<html>gateway timeout</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    );
    await expect(
      remoteModels("espada", "tok", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/customtypes/);
  });

  // A hung connection is the one failure with no error to propagate, so it is
  // the one that would sit in a fleet sweep forever rather than fail. Node's
  // fetch has no total-request deadline of its own, so the deadline has to be
  // attached here — and when it fires it must THROW like every other failure,
  // never resolve to [].
  it("arms each request with a deadline, and a timeout throws (never returns [])", async () => {
    const fetchImpl = hangsUntilAborted();
    const message = await messageOf(
      remoteModels("espada", "tok", fetchImpl as unknown as typeof fetch, 1),
    );
    expect(message).toMatch(/timed out after 1ms/);
    expect(message).toMatch(/espada/);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("sendModel", () => {
  it("POSTs a customtype insert to /customtypes/insert", async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL, _init?: RequestInit) => new Response("", { status: 201 }),
    );
    await sendModel(
      "espada",
      "tok",
      { kind: "customtype", id: "page", model: { id: "page" } },
      "insert",
      fetchImpl as unknown as typeof fetch,
    );
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${CUSTOM_TYPES_API}/customtypes/insert`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ id: "page" });
  });

  it("POSTs a slice update to /slices/update", async () => {
    // `null`, not `""`. 204 is a null-body status, so `new Response("", {status:
    // 204})` throws from the Response constructor itself — the test's own fake
    // never becomes a response, and the failure surfaces from inside the code
    // under test as if the request had failed. 204 is what the Types API really
    // answers to an update, so the fake has to be constructible.
    const fetchImpl = vi.fn(
      async (_url: string | URL, _init?: RequestInit) => new Response(null, { status: 204 }),
    );
    await sendModel(
      "espada",
      "tok",
      { kind: "slice", id: "hero", model: { id: "hero" } },
      "update",
      fetchImpl as unknown as typeof fetch,
    );
    expect((fetchImpl.mock.calls[0] as [string, RequestInit])[0]).toBe(
      `${CUSTOM_TYPES_API}/slices/update`,
    );
  });

  it("throws with the API's own message on a non-2xx", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("slice hero references unknown field", { status: 422 }),
    );
    await expect(
      sendModel(
        "espada",
        "tok",
        { kind: "slice", id: "hero", model: { id: "hero" } },
        "update",
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/422.*unknown field/s);
  });

  // Prismic keys the write on the id INSIDE the body; `entry.id` only ever
  // reaches the error message and the push report. If the two disagreed, an
  // `update` would replace a different live model than the one every log line
  // names — the worst possible combination in the one module allowed to write.
  // `types.ts` states the two cannot disagree because both constructors derive
  // `id` from the parsed model; this refuses to write anything that proves that
  // statement wrong, rather than trusting it at the point of no return.
  it("refuses to send an entry whose id disagrees with the model body", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 204 }));
    await expect(
      sendModel(
        "espada",
        "tok",
        { kind: "slice", id: "hero", model: { id: "not_hero" } },
        "update",
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/"hero".*"not_hero"/s);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("arms the write with a deadline, and a timeout throws", async () => {
    const fetchImpl = hangsUntilAborted();
    await expect(
      sendModel(
        "espada",
        "tok",
        { kind: "slice", id: "hero", model: { id: "hero" } },
        "update",
        fetchImpl as unknown as typeof fetch,
        1,
      ),
    ).rejects.toThrow(/timed out after 1ms/);
  });

  it("has no delete function at all", async () => {
    const mod = await import("../../../src/prismic/models/remote.js");
    expect(Object.keys(mod).some((k) => /delete|remove|destroy/i.test(k))).toBe(false);
  });
});
