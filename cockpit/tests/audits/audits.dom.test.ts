import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import Page from "../../src/routes/audits/+page.svelte";

/**
 * /audits behaviour (#582): the Run form, ported from RUN_SCRIPT. Every
 * response branch, with the exact request and the status line after.
 */

let target: HTMLElement;
let app: ReturnType<typeof mount> | null = null;
const fetchMock = vi.fn();

function render() {
  target = document.createElement("div");
  document.body.append(target);
  const data = JSON.parse(JSON.stringify({ audits: [] }));
  app = mount(Page, { target, props: { data } });
  flushSync();
}

const form = () => target.querySelector<HTMLFormElement>("#audit-run-form")!;
const status = () => target.querySelector<HTMLElement>("#audit-run-status")!;
const button = () => form().querySelector<HTMLButtonElement>('button[type="submit"]')!;

function fill() {
  const f = form();
  (f.elements.namedItem("url") as HTMLInputElement).value = "  https://acme.example  ";
  (f.elements.namedItem("business") as HTMLInputElement).value = "  Acme  ";
  (f.elements.namedItem("goal") as HTMLSelectElement).value = "book";
  (f.elements.namedItem("terms") as HTMLTextAreaElement).value = "roofing\nTPO";
  (f.elements.namedItem("questions") as HTMLTextAreaElement).value = "When?";
}

function submit() {
  form().dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
  flushSync();
}

async function settle() {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
  flushSync();
}

const json = (body: unknown, s: number) =>
  new Response(JSON.stringify(body), {
    status: s,
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  render();
});
afterEach(() => {
  if (app) unmount(app);
  app = null;
  target.remove();
  vi.unstubAllGlobals();
});

describe("the Run form", () => {
  it("posts the trimmed url and business, goal, terms and questions as JSON", async () => {
    fetchMock.mockResolvedValue(json({ message: "Audit queued." }, 202));
    fill();
    submit();
    expect(button().disabled).toBe(true);
    expect(button().textContent).toBe("Starting…");
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/prospect-audit/run");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({
      url: "https://acme.example",
      business: "Acme",
      goal: "book",
      terms: "roofing\nTPO",
      questions: "When?",
    });
  });

  it("on success shows the server's message, resets the form and re-arms the button", async () => {
    fetchMock.mockResolvedValue(json({ message: "Audit queued." }, 202));
    fill();
    submit();
    await settle();
    expect(status().textContent?.trim()).toBe("Audit queued.");
    expect(status().className).toBe("run-status");
    expect((form().elements.namedItem("business") as HTMLInputElement).value).toBe("");
    expect(button().disabled).toBe(false);
    expect(button().textContent).toBe("Run audit");
  });

  it("on success with no message says Audit started.", async () => {
    fetchMock.mockResolvedValue(new Response("not json", { status: 200 }));
    fill();
    submit();
    await settle();
    expect(status().textContent?.trim()).toBe("Audit started.");
  });

  it("a refusal shows the server's message as an error, keeps the form, and links an existing report", async () => {
    fetchMock.mockResolvedValue(
      json(
        { message: "Already audited today <b>x</b>.", reportUrl: "/r/BBBBBBBBBBBBBBBBBBBBBB" },
        409,
      ),
    );
    fill();
    submit();
    await settle();
    expect(status().className).toBe("run-status is-error");
    expect(status().textContent).toContain("Already audited today <b>x</b>.");
    expect(status().querySelector("b")).toBeNull();
    const link = status().querySelector("a")!;
    expect(link.getAttribute("href")).toBe("/r/BBBBBBBBBBBBBBBBBBBBBB");
    expect(link.textContent).toBe("View existing report →");
    expect((form().elements.namedItem("business") as HTMLInputElement).value).toBe("  Acme  ");
    expect(button().disabled).toBe(false);
  });

  it("a refusal with no body says Failed to start the audit.", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    fill();
    submit();
    await settle();
    expect(status().textContent?.trim()).toBe("Failed to start the audit.");
    expect(status().className).toBe("run-status is-error");
  });

  it("a network error says so, and clears an earlier report link", async () => {
    fetchMock.mockResolvedValueOnce(json({ message: "dup", reportUrl: "/r/x" }, 409));
    fill();
    submit();
    await settle();
    expect(status().querySelector("a")).not.toBeNull();
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    submit();
    await settle();
    expect(status().textContent?.trim()).toBe("Failed to start the audit — network error.");
    expect(status().className).toBe("run-status is-error");
    expect(status().querySelector("a")).toBeNull();
    expect(button().disabled).toBe(false);
    expect(button().textContent).toBe("Run audit");
  });

  it("a new submit clears the previous error before the request returns", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 500 }));
    fill();
    submit();
    await settle();
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)));
    submit();
    expect(status().textContent?.trim()).toBe("");
    expect(status().className).toBe("run-status");
    resolve(json({ message: "ok" }, 200));
    await settle();
  });
});
