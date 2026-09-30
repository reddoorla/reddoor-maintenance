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
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = {
        ...state,
        testMode: f.querySelector('[name="testMode"]')?.value ?? null,
        honeypot: f.querySelector('[name="bot-field"]').value,
      };
      const r = await fetch("/contact", { method: "POST", body: JSON.stringify(body) });
      if (r.ok && ${opts.banner ? "true" : "false"}) document.getElementById("ok").hidden = false;
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
  </script>
</body></html>`;

type Fixture = {
  health: unknown;
  banner: boolean;
  resetSelect?: boolean;
  disabledSubmit?: boolean;
};

let server: Server;
let base: string;
let fixture: Fixture;
let posts: Posted[];

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(fixture.health));
      return;
    }
    if (req.method === "GET" && req.url === "/contact") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        contactPage({
          banner: fixture.banner,
          resetSelect: fixture.resetSelect ?? false,
          disabledSubmit: fixture.disabledSubmit ?? false,
        }),
      );
      return;
    }
    if (req.method === "POST" && req.url === "/contact") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        posts.push(JSON.parse(raw) as Posted);
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"ok":true}');
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

async function submit(f: Fixture) {
  fixture = f;
  posts = [];
  runner = await defaultFormRunner();
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
      formRunner: await defaultFormRunner(),
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
  }, 90_000);
});

describe("form-e2e live runner — the instrument can fail, and the interlock holds", () => {
  it("reports a failure when the success banner never appears", async () => {
    const out = await submit({ health: DECLARED, banner: false });
    expect(out).toMatchObject({
      formPresent: true,
      success: false,
      synthesized: ["company", "interest", "consent", "contactBy"],
    });
  }, 90_000);

  it("submits NOTHING to a site whose /health does not declare forms.testMode", async () => {
    const out = await submit({ health: { ok: true, forms: { turnstile: false } }, banner: true });
    expect(out).toEqual({ testModeUndeclared: true });
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
  }, 90_000);
});

describe("SYNTHESIZE_REQUIRED_EXPR — only fields it can actually fill", () => {
  const synthesize = async (html: string) => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.setContent(html);
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
});

describe("form-e2e live runner — a probe that throws still says what it synthesized", () => {
  it("carries the synthesized names when the submit click itself fails", async () => {
    const out = await submit({ health: DECLARED, banner: true, disabledSubmit: true });
    expect(out).toMatchObject({
      formPresent: true,
      success: false,
      synthesized: ["company", "interest", "consent", "contactBy"],
    });
    expect(posts).toHaveLength(0);
  }, 90_000);
});
