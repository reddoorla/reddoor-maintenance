import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium } from "@playwright/test";
import {
  defaultFormRunner,
  formE2eAudit,
  SYNTHESIZE_REQUIRED_EXPR,
  type FormRunner,
} from "../../src/audits/form-e2e.js";

type Posted = Record<string, unknown>;

const contactPage = (opts: {
  banner: boolean;
  resetSelect: boolean;
  disabledSubmit: boolean;
  dropMarkerOnChange: boolean;
  dropMarkerAlways: boolean;
  statusOnError: boolean;
  statusFirst: boolean;
  beacon: boolean;
  encoding: Encoding;
  native: boolean;
  consent: Consent | undefined;
}) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Contact</title></head>
<body>
  <form id="contact" method="POST">
    <input type="hidden" name="ts" value="1">
    <input type="text" name="bot-field" tabindex="-1" autocomplete="off" style="display:none">
    <input type="text" name="name" required>
    <input type="email" name="email" required>
    <input type="tel" name="phone">
    <input type="text" name="company" required>
    <select name="interest" required>
      <option value="">Area of interest</option>
      <option value="closed" disabled>Closed</option>
      <option value="funds">Funds</option>
      <option value="other">Other</option>
    </select>
    <input type="checkbox" name="consent" required>
    <input type="radio" name="contactBy" value="email" required>
    <input type="radio" name="contactBy" value="phone" required>
    <input type="text" name="nickname">
    <select name="budget"><option value="">None</option><option value="big">Big</option></select>
    <textarea name="message" required></textarea>
    <button type="submit"${opts.disabledSubmit ? " disabled" : ""}>Send</button>
  </form>
  <p role="status" id="ok" hidden>Thanks, we will be in touch.</p>
  <script>
    const state = {};
    const f = document.getElementById("contact");
    const note = (e) => {
      const el = e.target;
      if (!el.name) return;
      if (el.type === "checkbox") state[el.name] = el.checked;
      else if (el.type === "radio") { if (el.checked) state[el.name] = el.value; }
      else state[el.name] = el.value;
    };
    const onChange = ["select-one", "checkbox", "radio"];
    f.addEventListener("input", (e) => { if (!onChange.includes(e.target.type)) note(e); });
    f.addEventListener("change", (e) => { if (onChange.includes(e.target.type)) note(e); });
    if (!${opts.native ? "true" : "false"}) f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = {
        ...state,
        testMode: f.querySelector('[name="testMode"]')?.value ?? null,
        cookieConsent: window.__consent ?? null,
        honeypot: f.querySelector('[name="bot-field"]').value,
      };
      const entries = () => Object.entries(body).map(([k, v]) => [k, String(v)]);
      const encode = {
        json: () => JSON.stringify(body),
        urlencoded: () => new URLSearchParams(entries()),
        multipart: () => { const d = new FormData(); for (const [k, v] of entries()) d.append(k, v); return d; },
        file: () => {
          const d = new FormData();
          for (const [k, v] of entries()) d.append(k, v);
          d.append("attachment", new File(["resume"], "resume.txt", { type: "text/plain" }));
          return d;
        },
      }[${JSON.stringify(opts.encoding)}];
      if (${opts.statusFirst ? "true" : "false"}) {
        const s = document.getElementById("ok");
        s.textContent = "Sending…";
        s.hidden = false;
      }
      if (${opts.beacon ? "true" : "false"}) await fetch("/beacon", { method: "POST", body: "ping" });
      const r = await fetch("/contact", { method: "POST", body: encode() });
      const failed = !r.ok || (await r.clone().json().catch(() => ({}))).type === "failure";
      if (!failed && ${opts.banner ? "true" : "false"}) {
        const s = document.getElementById("ok");
        s.textContent = "Thanks, we will be in touch.";
        s.hidden = false;
      }
      if (failed && ${opts.statusOnError ? "true" : "false"}) {
        const s = document.getElementById("ok");
        s.textContent = "Sorry, something went wrong. Please try again.";
        s.hidden = false;
      }
    });
    if (${opts.resetSelect ? "true" : "false"}) {
      const sel = f.querySelector('[name="interest"]');
      let reset = false;
      sel.addEventListener("change", () => {
        if (reset) return;
        reset = true;
        setTimeout(() => {
          sel.value = "";
          state.interest = "";
        }, 0);
      });
    }
    const dropMarker = () => f.querySelectorAll('[name="testMode"]').forEach((el) => el.remove());
    if (${opts.dropMarkerOnChange ? "true" : "false"}) {
      f.addEventListener("change", () => queueMicrotask(dropMarker));
    }
    if (${opts.dropMarkerAlways ? "true" : "false"}) {
      new MutationObserver(dropMarker).observe(f, { childList: true });
    }
  </script>
  ${opts.consent === undefined ? "" : consentGate(opts.consent)}
</body></html>`;

/** Which answers the cookie-consent gate offers (#1736). */
type Consent = "both" | "acceptOnly" | "none" | "covered" | "lateButtons" | "accordion";

/** gallerysonder's gate, reduced: a full-screen `role="dialog"` named "Cookie
 *  consent" that mounts on a timer (3 s there) over the whole page, so it
 *  intercepts the submit click until the visitor answers it, then fades out
 *  inert for 600 ms, still in the DOM. The answer is
 *  posted with the form, so a test can see which button the probe chose. */
const consentGate = (offer: Consent) => `
  <script>
    setTimeout(() => {
      const gate = document.createElement("div");
      gate.setAttribute("role", "dialog");
      gate.setAttribute("aria-modal", "true");
      gate.setAttribute("aria-label", "Cookie consent");
      gate.style.cssText = "position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.5)";
      gate.innerHTML = '<p>We use cookies to improve your experience.</p>' +
        // An accordion toggle whose name mentions "necessary", before the real answer.
        (${JSON.stringify(offer)} === "accordion"
          ? '<button type="button">Strictly necessary cookies ▸</button><button type="button" data-answer="reject">Reject all</button>' : "") +
        (["none", "accordion", "lateButtons"].includes(${JSON.stringify(offer)}) ? "" :
          '<button type="button" data-answer="accept">Accept</button>' +
          (${JSON.stringify(offer)} === "both" || ${JSON.stringify(offer)} === "covered"
            ? '<button type="button" data-answer="reject">Reject</button>' : "") +
          // "covered": a sheet over the gate's own buttons, so neither takes a click.
          (${JSON.stringify(offer)} === "covered"
            ? '<div style="position:absolute;inset:0;z-index:1"></div>' : ""));
      gate.addEventListener("click", (e) => {
        const answer = e.target.dataset?.answer;
        if (!answer) return;
        window.__consent = answer;
        // Svelte's outro: the gate stays in the DOM for its fade, inert, so a
        // second answer cannot land on it (gallerysonder's transition:fade).
        gate.inert = true;
        gate.style.opacity = "0.5";
        setTimeout(() => gate.remove(), 600);
      });
      document.body.appendChild(gate);
      // The shell first, its buttons 300 ms later, as some consent managers mount.
      if (${JSON.stringify(offer)} === "lateButtons") setTimeout(() => {
        gate.insertAdjacentHTML("beforeend", '<button type="button" data-answer="reject">Reject</button>');
      }, 300);
    }, 300);
  </script>`;

/** A contact form with no required field, and a consent gate that mounts
 *  `gateAfterMs` after load, while the probe's submit click is already
 *  waiting on the button, as gallerysonder's does. With `reload`, answering it
 *  reloads the page (once per tab), as some consent managers do, so the click
 *  that follows meets a fresh form with no fills and no marker (#1736 review). */
const lateGatePage = (gateAfterMs: number, reload: boolean) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Contact</title></head>
<body>
  <form id="contact" method="POST">
    <input type="text" name="name"><input type="email" name="email"><input type="tel" name="phone">
    <textarea name="message"></textarea><button type="submit" disabled>Send</button>
  </form>
  <p role="status" id="ok" hidden>Thanks, we will be in touch.</p>
  <script>
    const f = document.getElementById("contact");
    // Enabled 500 ms after the gate mounts, so the probe's click is already
    // waiting on it when the gate lands, as gallerysonder's 3 s gate meets it.
    setTimeout(() => (f.querySelector("button").disabled = false), ${gateAfterMs} + 500);
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(f));
      const r = await fetch("/contact", { method: "POST", body: JSON.stringify(body) });
      if (r.ok) document.getElementById("ok").hidden = false;
    });
    if (!sessionStorage.getItem("answered")) setTimeout(() => {
      const gate = document.createElement("div");
      gate.setAttribute("role", "dialog");
      gate.setAttribute("aria-label", "Cookie consent");
      gate.style.cssText = "position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.5)";
      gate.innerHTML = '<p>We use cookies.</p><button type="button">Accept</button><button type="button">Reject</button>';
      gate.addEventListener("click", (e) => {
        if (e.target.tagName !== "BUTTON") return;
        sessionStorage.setItem("answered", "1");
        if (${reload ? "true" : "false"}) location.reload();
        else gate.remove();
      });
      document.body.appendChild(gate);
    }, ${gateAfterMs});
  </script>
</body></html>`;

type Hydration = {
  delayMs: number;
  marker: boolean;
  rerenderAfterMs?: number;
};

const hydratingPage = (h: Hydration, banner: boolean) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Contact</title></head>
<body>
  <main id="app"><form method="POST"><input type="text" name="name" required><input type="email" name="email" required><input type="tel" name="phone"><textarea name="message" required></textarea><button type="submit">Send</button></form></main>
  <p role="status" id="ok" hidden>Thanks, we will be in touch.</p>
  <script>
    const app = document.getElementById("app");
    const serverHtml = app.innerHTML;
    const rendered = ["name", "email", "phone", "message", ""];
    window.__mounts = 0;
    const mount = () => {
      app.innerHTML = serverHtml;
      window.__mounts++;
      claim();
    };
    const claim = () => {
      const f = app.querySelector("form");
      f.addEventListener("submit", async (e) => {
        e.preventDefault();
        const body = Object.fromEntries(new FormData(f));
        const r = await fetch("/contact", { method: "POST", body: JSON.stringify(body) });
        if (r.ok && ${banner ? "true" : "false"}) document.getElementById("ok").hidden = false;
      });
    };
    let hydrated = false;
    const hydrate = () => {
      hydrated = true;
      const f = app.querySelector("form");
      const names = Array.from(f.children).map((el) => el.getAttribute("name") ?? "");
      const foreign = names.some((n) => !rendered.includes(n));
      if (foreign) {
        console.warn("https://svelte.dev/e/hydration_mismatch");
        mount();
      } else {
        claim();
      }
      if (${h.marker ? "true" : "false"}) document.documentElement.dataset.hydrated = "";
      if (${h.rerenderAfterMs === undefined ? "false" : "true"}) setTimeout(mount, ${h.rerenderAfterMs ?? 0});
    };
    const earliest = Date.now() + ${h.delayMs};
    let timer = setTimeout(hydrate, ${h.delayMs});
    document.addEventListener(
      "input",
      () => {
        if (hydrated) return;
        clearTimeout(timer);
        timer = setTimeout(hydrate, Math.max(400, earliest - Date.now()));
      },
      true,
    );
  </script>
</body></html>`;

/** How the page encodes its action POST: JSON (a hand-rolled fetch), URL-encoded
 *  (SvelteKit use:enhance's default), multipart, or multipart with a File (whose
 *  body Playwright cannot read, postData() null). */
type Encoding = "json" | "urlencoded" | "multipart" | "file";

type Fixture = {
  health: unknown;
  /** The /health status (default 200). */
  healthStatus?: number;
  banner: boolean;
  resetSelect?: boolean;
  disabledSubmit?: boolean;
  dropMarkerOnChange?: boolean;
  dropMarkerAlways?: boolean;
  hydration?: Hydration;
  /** The action POST's status (default 200). */
  postStatus?: number;
  /** On a failed POST, the page writes its error into the same role="status" region. */
  statusOnError?: boolean;
  /** The page shows its role="status" region ("Sending…") before it posts. */
  statusFirst?: boolean;
  /** How long the server holds the action POST before answering. */
  postDelayMs?: number;
  /** The action answers 200 with a SvelteKit `fail()` body, as `use:enhance` receives it. */
  kitFailure?: boolean;
  /** A same-site POST to /beacon goes first, answering this status. */
  beaconStatus?: number;
  encoding?: Encoding;
  /** No script handles the submit: the browser posts the form, the action answers
   *  303 to /thanks, and /thanks shows the status region. */
  native?: boolean;
  /** A cookie-consent gate mounts over the page 300 ms after load (#1736). */
  consent?: Consent;
  /** Serve lateGatePage instead: its gate mounts after this many ms. */
  lateGate?: { afterMs: number; reload: boolean };
};

let server: Server;
let base: string;
let fixture: Fixture;
let posts: Posted[];
let healthReads = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      healthReads++;
      res.writeHead(fixture.healthStatus ?? 200, { "content-type": "application/json" });
      res.end(JSON.stringify(fixture.health));
      return;
    }
    if (req.method === "GET" && req.url === "/contact") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      if (fixture.hydration) {
        res.end(hydratingPage(fixture.hydration, fixture.banner));
        return;
      }
      if (fixture.lateGate) {
        res.end(lateGatePage(fixture.lateGate.afterMs, fixture.lateGate.reload));
        return;
      }
      res.end(
        contactPage({
          banner: fixture.banner,
          resetSelect: fixture.resetSelect ?? false,
          disabledSubmit: fixture.disabledSubmit ?? false,
          dropMarkerOnChange: fixture.dropMarkerOnChange ?? false,
          dropMarkerAlways: fixture.dropMarkerAlways ?? false,
          statusOnError: fixture.statusOnError ?? false,
          statusFirst: fixture.statusFirst ?? false,
          beacon: fixture.beaconStatus !== undefined,
          encoding: fixture.encoding ?? "json",
          native: fixture.native ?? false,
          consent: fixture.consent,
        }),
      );
      return;
    }
    if (req.method === "GET" && req.url === "/thanks") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end('<!doctype html><p role="status">Thanks, we will be in touch.</p>');
      return;
    }
    if (req.method === "POST" && req.url === "/beacon") {
      req.resume();
      req.on("end", () => {
        res.writeHead(fixture.beaconStatus ?? 204);
        res.end();
      });
      return;
    }
    if (req.method === "POST" && req.url === "/contact") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        try {
          posts.push(JSON.parse(raw) as Posted);
        } catch {
          posts.push({ unparsed: raw });
        }
        if (fixture.native) {
          res.writeHead(303, { location: "/thanks" });
          res.end();
          return;
        }
        const answer = () => {
          const status = fixture.postStatus ?? 200;
          res.writeHead(status, { "content-type": "application/json" });
          if (fixture.kitFailure) res.end('{"type":"failure","status":502,"data":"[]"}');
          else res.end(status < 400 ? '{"ok":true}' : '{"error":"ingest failed"}');
        };
        if (fixture.postDelayMs) setTimeout(answer, fixture.postDelayMs);
        else answer();
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

let runner: FormRunner | null = null;
afterEach(async () => {
  await runner?.close?.();
  runner = null;
});

const DECLARED = { ok: true, forms: { testMode: true, turnstile: false } };

type RunnerOpts = NonNullable<Parameters<typeof defaultFormRunner>[0]>;

/**
 * The waits these fixtures can afford to shorten. The production defaults
 * (5 s hydration cap, 1200 ms settle, 30 s submit waits) are pinned without a
 * browser in form-e2e-runner-timing.test.ts; the tests below that exercise a
 * default's own behaviour pass their values explicitly.
 * - hydrationTimeoutMs 500: contactPage never writes html[data-hydrated] and
 *   needs no hydration (its script runs inline before domcontentloaded), so the
 *   wait always runs to the cap. 500 still runs the wait rather than skipping it.
 * - settleMs 200: the fixtures have no bot-timing screen. The one thing the
 *   settle must outlast is resetSelect's setTimeout(0) revert, which the re-check
 *   after the settle has to see; 200 ms is far past a zero-delay task.
 */
const FAST_SETTLE_MS = 200;
const FAST: RunnerOpts = { hydrationTimeoutMs: 500, settleMs: FAST_SETTLE_MS };
/** For the two fixtures that must fail at the submit: the banner never shows,
 *  or the click never lands. 3 s instead of 30 s to reach that failure. */
const FAST_FAIL: RunnerOpts = { ...FAST, submitTimeoutMs: 3000 };

async function submit(f: Fixture, opts: RunnerOpts = FAST) {
  fixture = f;
  posts = [];
  runner = await defaultFormRunner(opts);
  return runner.submit({ baseUrl: base, testMode: true, testSitekey: "1x00000000000000000000AA" });
}

describe("form-e2e live runner — positive control", () => {
  it("passes a known-good form whose required set goes beyond name/email/phone/message", async () => {
    const out = await submit({ health: DECLARED, banner: true });
    expect(out).toMatchObject({ formPresent: true, success: true });
    expect(posts).toHaveLength(1);
  }, 90_000);

  it("delivers the testMode marker with the submission", async () => {
    await submit({ health: DECLARED, banner: true });
    expect(posts[0]?.testMode).toBe("true");
  }, 90_000);

  it("scores the same audit a pass end to end", async () => {
    fixture = { health: DECLARED, banner: true };
    posts = [];
    const r = await formE2eAudit({
      site: { path: "", name: "fixture", deployedUrl: base },
      formRunner: await defaultFormRunner(FAST),
    });
    expect(r.status).toBe("pass");
    expect((r.details as { ok?: string }).ok).toBe("pass");
  }, 90_000);
});

describe("form-e2e live runner — required fields outside the standard fill set (#779)", () => {
  it("picks the first real option of a required select, skipping placeholders and disabled ones", async () => {
    await submit({ health: DECLARED, banner: true });
    expect(posts[0]?.interest).toBe("funds");
  }, 90_000);

  it("fills a required text input, a required checkbox and one radio of a required group", async () => {
    await submit({ health: DECLARED, banner: true });
    expect(typeof posts[0]?.company).toBe("string");
    expect(String(posts[0]?.company).trim()).not.toBe("");
    expect(posts[0]?.consent).toBe(true);
    expect(posts[0]?.contactBy).toBe("email");
  }, 90_000);

  it("leaves optional fields and the honeypot alone", async () => {
    await submit({ health: DECLARED, banner: true });
    expect(posts[0]?.honeypot).toBe("");
    expect(posts[0]).not.toHaveProperty("nickname");
    expect(posts[0]).not.toHaveProperty("budget");
  }, 90_000);

  it("keeps the standard values for the standard fields", async () => {
    await submit({ health: DECLARED, banner: true });
    expect(posts[0]?.email).toBe("monitor+e2e@reddoorla.com");
    expect(posts[0]?.message).toBe("Synthetic end-to-end health check — please ignore.");
  }, 90_000);

  it("names the fields it synthesized, so a pass says what the probe chose", async () => {
    const out = await submit({ health: DECLARED, banner: true });
    expect(out).toMatchObject({ synthesized: ["company", "interest", "consent", "contactBy"] });
    expect(out).not.toHaveProperty("resynthesized");
  }, 90_000);
});

describe("form-e2e live runner — the verdict is the POST, not the banner (#1610)", () => {
  it("fails a POST that returned 500 even though the status region showed", async () => {
    const out = await submit({
      health: DECLARED,
      banner: true,
      postStatus: 500,
      statusOnError: true,
    });
    expect(out).toMatchObject({ formPresent: true, success: false });
    expect((out as { detail?: string }).detail).toMatch(
      /^the status region showed, but the submission failed — POST 500 \{"error":"ingest failed"\}/,
    );
  });

  it("scores that run as not passing end to end", async () => {
    fixture = { health: DECLARED, banner: true, postStatus: 500, statusOnError: true };
    posts = [];
    runner = await defaultFormRunner(FAST);
    const r = await formE2eAudit({
      site: { name: "fixture", path: "/x", deployedUrl: base },
      formRunner: runner,
    });
    expect(r.status).not.toBe("pass");
    expect((r.details as { ok?: string }).ok).toBe("fail");
  });

  it.each([400, 422, 503])("a %i the page reports in the status region fails", async (code) => {
    const out = await submit({
      health: DECLARED,
      banner: true,
      postStatus: code,
      statusOnError: true,
    });
    expect(out).toMatchObject({ formPresent: true, success: false });
    expect((out as { detail?: string }).detail).toContain(`POST ${code}`);
  });

  it.each(["urlencoded", "multipart", "file"] as const)(
    "a %s action POST is the one read: its 500 behind the status region fails",
    async (encoding) => {
      // The fleet's own encodings: use:enhance posts URL-encoded, a FormData fetch
      // multipart, and an attachment makes Playwright's postData() null.
      const out = await submit({
        health: DECLARED,
        banner: true,
        encoding,
        beaconStatus: 200,
        postStatus: 500,
        statusOnError: true,
      });
      expect(out).toMatchObject({ formPresent: true, success: false });
      expect((out as { detail?: string }).detail).toContain("POST 500");
    },
  );

  it("a URL-encoded SvelteKit fail() inside a 200 fails", async () => {
    const out = await submit({
      health: DECLARED,
      banner: true,
      encoding: "urlencoded",
      kitFailure: true,
      statusOnError: true,
    });
    expect(out).toMatchObject({ formPresent: true, success: false });
  });

  it("a native form whose action answers 303 to a thanks page passes", async () => {
    // A redirect response has no body to read; that must not turn a pass into a throw.
    const out = await submit({ health: DECLARED, banner: true, native: true });
    expect(out).toMatchObject({ formPresent: true, success: true });
  });

  it("a SvelteKit action's fail() inside a 200 fails", async () => {
    const out = await submit({
      health: DECLARED,
      banner: true,
      kitFailure: true,
      statusOnError: true,
    });
    expect(out).toMatchObject({ formPresent: true, success: false });
    expect((out as { detail?: string }).detail).toMatch(
      /^the status region showed, but the submission failed — POST 200 \{"type":"failure","status":502/,
    );
  });

  // #1669 (A14). The body is read for every status below 400, not only 200: a 201
  // whose body is a kit failure fails too, and a plain 201 still passes.
  it("a SvelteKit fail() inside a 201 fails", async () => {
    const out = await submit({
      health: DECLARED,
      banner: true,
      postStatus: 201,
      kitFailure: true,
      statusOnError: true,
    });
    expect(out).toMatchObject({ formPresent: true, success: false });
    expect((out as { detail?: string }).detail).toMatch(
      /^the status region showed, but the submission failed — POST 201 \{"type":"failure","status":502/,
    );
  });

  it("control: a 201 POST with an ordinary body and the thanks banner passes", async () => {
    const out = await submit({
      health: DECLARED,
      banner: true,
      postStatus: 201,
      statusOnError: true,
    });
    expect(out).toMatchObject({ formPresent: true, success: true });
  });

  it("the region shown before the POST: a 500 that answers 800 ms later still fails", async () => {
    const out = await submit({
      health: DECLARED,
      banner: true,
      statusFirst: true,
      postDelayMs: 800,
      postStatus: 500,
      statusOnError: true,
    });
    expect(out).toMatchObject({ formPresent: true, success: false });
  });

  it("a POST still pending when the settle ends passes, without waiting for it", async () => {
    // The region shows at once and the POST takes 10 s: the 2 s settle ends the wait,
    // not the 30 s submit timeout.
    const started = Date.now();
    const out = await submit({
      health: DECLARED,
      banner: true,
      statusFirst: true,
      postDelayMs: 10_000,
    });
    expect(out).toMatchObject({ formPresent: true, success: true });
    expect(Date.now() - started).toBeLessThan(6_000);
  }, 20_000);

  it("a same-site beacon that 404s first does not fail a form whose action succeeded", async () => {
    const out = await submit({ health: DECLARED, banner: true, beaconStatus: 404 });
    expect(out).toMatchObject({ formPresent: true, success: true });
  });

  it("a same-site beacon that answers 200 first does not hide the action's 500", async () => {
    const out = await submit({
      health: DECLARED,
      banner: true,
      beaconStatus: 200,
      postStatus: 500,
      statusOnError: true,
    });
    expect(out).toMatchObject({ formPresent: true, success: false });
    expect((out as { detail?: string }).detail).toContain("POST 500");
  });

  it("control: a 200 POST with the thanks banner still passes", async () => {
    const out = await submit({
      health: DECLARED,
      banner: true,
      postStatus: 200,
      statusOnError: true,
    });
    expect(out).toMatchObject({ formPresent: true, success: true });
  });
});

describe("form-e2e live runner — the instrument can fail, and the interlock holds", () => {
  it("reports a failure when the success banner never appears", async () => {
    const out = await submit({ health: DECLARED, banner: false, resetSelect: true }, FAST_FAIL);
    expect(out).toMatchObject({
      formPresent: true,
      success: false,
      synthesized: ["company", "interest", "consent", "contactBy"],
      resynthesized: ["interest"],
    });
    // A banner that never showed keeps its own diagnosis, not "the status region showed".
    expect((out as { detail?: string }).detail).toMatch(/^no success banner after submit — /);
  }, 90_000);

  it("submits NOTHING to a site whose /health does not declare forms.testMode", async () => {
    const out = await submit({ health: { ok: true, forms: { turnstile: false } }, banner: true });
    expect(out).toEqual({ testModeUndeclared: true });
    expect(posts).toHaveLength(0);
  }, 90_000);

  // P1-68: an unreadable /health refuses the submit like an undeclared one, but says so.
  it("submits NOTHING when /health answers 503, and names the status", async () => {
    healthReads = 0;
    const out = await submit({ health: DECLARED, healthStatus: 503, banner: true });
    expect(out).toEqual({ testModeUndeclared: true, healthUnreadable: "HTTP 503" });
    expect(healthReads).toBe(2);
    expect(posts).toHaveLength(0);
  }, 90_000);

  it("submits NOTHING when /health declares testMode:false explicitly", async () => {
    const out = await submit({
      health: { ok: true, forms: { testMode: false, turnstile: false } },
      banner: true,
    });
    expect(out).toEqual({ testModeUndeclared: true });
    expect(posts).toHaveLength(0);
  }, 90_000);
});

describe("form-e2e live runner — a synthesized value reverted after the fill (#779 review)", () => {
  it("re-synthesizes a select the page reset during the settle, and still passes", async () => {
    const out = await submit({ health: DECLARED, banner: true, resetSelect: true });
    expect(out).toMatchObject({ formPresent: true, success: true, resynthesized: ["interest"] });
    expect(out).not.toHaveProperty("refilled");
    expect(posts[0]?.interest).toBe("funds");
    expect(posts[0]?.testMode).toBe("true");
  }, 90_000);
});

describe("form-e2e live runner — the marker is on the form at the click, or nothing is sent (#779 round 3)", () => {
  it("puts the marker back when re-setting a field makes the page drop it", async () => {
    const out = await submit({
      health: DECLARED,
      banner: true,
      resetSelect: true,
      dropMarkerOnChange: true,
    });
    expect(out).toMatchObject({ success: true, resynthesized: ["interest"] });
    expect(posts).toHaveLength(1);
    expect(posts[0]?.testMode).toBe("true");
  }, 90_000);

  it("refuses to click when the page keeps removing the marker, so no unmarked probe is sent", async () => {
    const out = await submit({ health: DECLARED, banner: true, dropMarkerAlways: true });
    expect(posts).toHaveLength(0);
    expect(out).toMatchObject({ formPresent: true, success: false });
    expect((out as { detail?: string }).detail).toContain("testMode marker");
  }, 90_000);
});

describe("form-e2e live runner — the probe does not cause the wipe it reports (#1148)", () => {
  const PRE_HYDRATION = { delayMs: 700, marker: false };

  it("control: injecting before hydration makes the page re-mount, and the probe reports refilled", async () => {
    // Default settle on purpose: the re-mount lands ~700 ms in (or 400 ms after
    // the fills), so the settle must outlast it for the re-check to see the wipe.
    const out = await submit(
      { health: DECLARED, banner: true, hydration: PRE_HYDRATION },
      { hydrationTimeoutMs: 0 },
    );
    expect(out).toMatchObject({
      formPresent: true,
      success: true,
      refilled: true,
      hydrationUnconfirmed: true,
    });
    expect(posts).toHaveLength(1);
    expect(posts[0]?.testMode).toBe("true");
  }, 90_000);

  it("waits out hydration on a site without the marker, so a page with no real mismatch is not refilled", async () => {
    // The cap must outlast PRE_HYDRATION's 700 ms delay, since this fixture
    // writes no marker: 2500 leaves 1800 ms of margin on a slow runner.
    const out = await submit(
      { health: DECLARED, banner: true, hydration: PRE_HYDRATION },
      { hydrationTimeoutMs: 2500, settleMs: FAST_SETTLE_MS },
    );
    expect(out).toMatchObject({ formPresent: true, success: true });
    expect(out).not.toHaveProperty("refilled");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.testMode).toBe("true");
    expect(posts[0]?.email).toBe("monitor+e2e@reddoorla.com");
  }, 90_000);

  it("waits for html[data-hydrated] on a site that writes it, and no longer than that", async () => {
    const t0 = Date.now();
    const out = await submit(
      { health: DECLARED, banner: true, hydration: { delayMs: 2500, marker: true } },
      { hydrationTimeoutMs: 30_000, settleMs: FAST_SETTLE_MS },
    );
    expect(Date.now() - t0).toBeLessThan(20_000);
    expect(out).toMatchObject({ formPresent: true, success: true });
    expect(out).not.toHaveProperty("refilled");
  }, 90_000);

  it("still reports refilled for a real client re-render after hydration", async () => {
    // All defaults on purpose: the re-render lands 400 ms after the marker, so it
    // must fall inside the settle (the default 1200 ms) for the re-check to see it.
    const out = await submit(
      {
        health: DECLARED,
        banner: true,
        hydration: { delayMs: 300, marker: true, rerenderAfterMs: 400 },
      },
      {},
    );
    expect(out).toMatchObject({ formPresent: true, success: true, refilled: true });
    expect(out).not.toHaveProperty("hydrationUnconfirmed");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.testMode).toBe("true");
    expect(posts[0]?.email).toBe("monitor+e2e@reddoorla.com");
  }, 90_000);
});

describe("SYNTHESIZE_REQUIRED_EXPR — only fields it can actually fill", () => {
  const synthesize = async (html: string) => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`data:text/html,${encodeURIComponent(html)}`);
      const names = (await page.evaluate(SYNTHESIZE_REQUIRED_EXPR)) as string[];
      const values = (await page.evaluate(
        "Object.fromEntries(Array.from(document.forms[0].elements).filter((e) => e.name).map((e) => [e.name, e.value]))",
      )) as Record<string, string>;
      return { names, values };
    } finally {
      await browser.close();
    }
  };

  it("does not claim a field whose type rejects the synthetic value", async () => {
    const { names } = await synthesize(
      `<form><input type="time" name="callback" required><input type="text" name="company" required></form>`,
    );
    expect(names).toEqual(["company"]);
  }, 30_000);

  it("leaves a required control inside a disabled fieldset alone", async () => {
    const { names, values } = await synthesize(
      `<form><fieldset disabled><input type="text" name="later" required></fieldset><input type="text" name="company" required></form>`,
    );
    expect(names).toEqual(["company"]);
    expect(values.later).toBe("");
  }, 30_000);

  it("fills the typed fields with values the browser accepts", async () => {
    const { names, values } = await synthesize(
      `<form><input type="url" name="site" required><input type="number" name="n" min="3" required><input type="date" name="d" required></form>`,
    );
    expect(names).toEqual(["site", "n", "d"]);
    expect(values).toEqual({ site: "https://reddoorla.com", n: "3", d: "2026-01-01" });
  }, 30_000);

  it("uses a date field's min, so a future-only date is accepted", async () => {
    const { names, values } = await synthesize(
      `<form><input type="date" name="d" min="2031-03-01" required></form>`,
    );
    expect(names).toEqual(["d"]);
    expect(values.d).toBe("2031-03-01");
  }, 30_000);

  it("cuts the synthetic text to a field's maxlength", async () => {
    const { values } = await synthesize(
      `<form><input type="text" name="company" maxlength="10" required></form>`,
    );
    expect(values.company).toHaveLength(10);
  }, 30_000);

  it("picks a real option when the selected placeholder is disabled and has no value attribute", async () => {
    const { names, values } = await synthesize(
      `<form><select name="service" required><option disabled selected>Select a service</option><option disabled>Closed</option><option>Implants</option></select></form>`,
    );
    expect(names).toEqual(["service"]);
    expect(values.service).toBe("Implants");
  }, 30_000);

  it("does not claim a field its synthetic value leaves invalid, and leaves it empty", async () => {
    const { names, values } = await synthesize(
      `<form><input type="text" name="zip" pattern="[0-9]{5}" required><input type="number" name="guests" max="0" required><input type="text" name="company" required></form>`,
    );
    expect(names).toEqual(["company"]);
    expect(values.zip).toBe("");
    expect(values.guests).toBe("");
  }, 30_000);
});

describe("form-e2e live runner — a cookie-consent gate over the form (#1736)", () => {
  it("answers the gate with Reject, so no analytics load, and the submission passes", async () => {
    const out = await submit({ health: DECLARED, banner: true, consent: "both" }, FAST_FAIL);
    expect(out).toMatchObject({ formPresent: true, success: true, consentAnswered: "Reject" });
    // Answered once: the gate fading out, inert, is not a second gate to answer.
    expect(out).not.toHaveProperty("consentUnanswered");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.cookieConsent).toBe("reject");
    expect(posts[0]?.testMode).toBe("true");
  }, 90_000);

  it("answers Accept when that is the only way past the gate", async () => {
    const out = await submit({ health: DECLARED, banner: true, consent: "acceptOnly" }, FAST_FAIL);
    expect(out).toMatchObject({ formPresent: true, success: true, consentAnswered: "Accept" });
    expect(posts[0]?.cookieConsent).toBe("accept");
  }, 90_000);

  it("a gate no visitor can answer still fails, and the detail names what blocked the click", async () => {
    const out = await submit({ health: DECLARED, banner: true, consent: "none" }, FAST_FAIL);
    expect(out).toMatchObject({ formPresent: true, success: false });
    expect(posts).toHaveLength(0);
    const detail = (out as { detail?: string }).detail ?? "";
    expect(detail).toContain(
      "a cookie-consent dialog covered the page and the probe could not answer it",
    );
    expect(detail).toMatch(/intercepts pointer events/);
  }, 90_000);

  it("a gate that lands while the submit click waits is answered, and the click passes", async () => {
    const out = await submit(
      { health: DECLARED, banner: true, lateGate: { afterMs: 1500, reload: false } },
      { ...FAST, submitTimeoutMs: 8000 },
    );
    expect(out).toMatchObject({ formPresent: true, success: true, consentAnswered: "Reject" });
    expect(posts).toHaveLength(1);
    expect(posts[0]?.testMode).toBe("true");
  }, 90_000);

  it("a late gate that reloads the page on its answer never lets an unmarked form through", async () => {
    await submit(
      { health: DECLARED, banner: true, lateGate: { afterMs: 1500, reload: true } },
      { ...FAST, submitTimeoutMs: 8000 },
    );
    // Whatever the click sent after the reload, it carried the marker.
    for (const p of posts) expect(p.testMode).toBe("true");
    expect(posts.length).toBeGreaterThan(0);
  }, 90_000);

  it("a gate whose buttons arrive after its shell is still answered", async () => {
    const out = await submit({ health: DECLARED, banner: true, consent: "lateButtons" }, FAST_FAIL);
    expect(out).toMatchObject({ formPresent: true, success: true, consentAnswered: "Reject" });
    expect(posts[0]?.cookieConsent).toBe("reject");
  }, 90_000);

  it("presses Reject all, not an accordion toggle whose name mentions necessary cookies", async () => {
    const out = await submit({ health: DECLARED, banner: true, consent: "accordion" }, FAST_FAIL);
    expect(out).toMatchObject({ formPresent: true, success: true, consentAnswered: "Reject all" });
  }, 90_000);

  it("a gate whose buttons refuse the click fails without crashing the run", async () => {
    const t0 = Date.now();
    const out = await submit({ health: DECLARED, banner: true, consent: "covered" }, FAST_FAIL);
    expect(out).toMatchObject({ formPresent: true, success: false, consentUnanswered: true });
    // One 5 s try at the refused button, not one per retry of the click: 9 s
    // measured, 44 s when every retry tried again.
    expect(Date.now() - t0).toBeLessThan(25_000);
    expect(posts).toHaveLength(0);
    expect((out as { detail?: string }).detail).toContain(
      "a cookie-consent dialog covered the page and the probe could not answer it",
    );
  }, 90_000);
});

describe("form-e2e live runner — a probe that throws still says what it synthesized", () => {
  it("carries the synthesized names when the submit click itself fails", async () => {
    const out = await submit(
      {
        health: DECLARED,
        banner: true,
        disabledSubmit: true,
        resetSelect: true,
      },
      FAST_FAIL,
    );
    expect(out).toMatchObject({
      formPresent: true,
      success: false,
      synthesized: ["company", "interest", "consent", "contactBy"],
      resynthesized: ["interest"],
    });
    expect(posts).toHaveLength(0);
  }, 90_000);
});
