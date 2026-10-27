import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createRawSnippet } from "svelte";
import { render } from "svelte/server";
import { parse } from "node-html-parser";
import Layout from "../../src/routes/+layout.svelte";

/**
 * The one shell every cockpit page renders through (#582, step 1 of the #672
 * rework): one nav bar (Home · Sites · Inbox · Audits), the shared styles and
 * the signed-in fragment.
 */

const page = createRawSnippet(() => ({ render: () => "<main>page body</main>" }));

function shell(path: string, email: string | null = "op@example.com") {
  const { body, head } = render(Layout, { props: { data: { email, path }, children: page } });
  return { root: parse(body), head };
}

describe("the shell", () => {
  it("renders one nav bar, in order, around the page", () => {
    const { root } = shell("/");
    const navs = root.querySelectorAll("nav");
    expect(navs).toHaveLength(1);
    expect(navs[0]!.querySelectorAll("a").map((a) => [a.text, a.getAttribute("href")])).toEqual([
      ["Home", "/"],
      ["Sites", "/fleet"],
      ["Inbox", "/submissions"],
      ["Audits", "/audits"],
    ]);
    expect(root.querySelector("main")?.text).toBe("page body");
  });

  it.each([
    ["/", "Home"],
    ["/fleet", "Sites"],
    ["/s/acme-co", "Sites"],
    ["/submissions", "Inbox"],
    ["/audits", "Audits"],
  ])("marks the current page for %s", (path, label) => {
    const current = shell(path).root.querySelectorAll('nav a[aria-current="page"]');
    expect(current.map((a) => a.text)).toEqual([label]);
  });

  it("names the signed-in operator with a sign-out link, escaped", () => {
    const { root } = shell("/", `<i>op</i>@example.com`);
    // P1-78e: the identity moved from an inline-styled div into .shell-account,
    // beside the theme toggle; the selector follows it, the assertions do not change.
    const chrome = root.querySelector("header .shell-account > span");
    expect(chrome?.text.replace(/\s+/g, " ").trim()).toBe("<i>op</i>@example.com · sign out");
    expect(chrome?.querySelector("i")).toBeNull();
    expect(chrome?.querySelector("a")?.getAttribute("href")).toBe("/auth/logout");
  });

  it("names nobody under the shared-password fallback", () => {
    const { root } = shell("/", null);
    expect(root.querySelector("header .shell-account > span")).toBeNull();
    expect(root.querySelector("nav")).not.toBeNull();
  });

  it("carries the favicon in the head", () => {
    expect(shell("/").head).toContain('rel="icon"');
  });
});

/** Every page file under routes/, relative to it. */
function pages(dir: string, root = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return pages(p, root);
    return name === "+page.svelte" ? [relative(root, p)] : [];
  });
}

describe("every route renders through the shell", () => {
  const routes = join(import.meta.dirname, "../../src/routes");

  it("has exactly one layout, the root one, and it renders the shell", () => {
    const layouts = readdirSync(routes, { recursive: true }).filter((f) =>
      String(f).endsWith("+layout.svelte"),
    );
    expect(layouts).toEqual(["+layout.svelte"]);
    expect(readFileSync(join(routes, "+layout.svelte"), "utf8")).toMatch(/<Shell\b/);
  });

  it("no page opts out of the root layout", () => {
    // `+page@.svelte` or `+page@x.svelte` resets the layout chain.
    const files = readdirSync(routes, { recursive: true }).map(String);
    expect(files.filter((f) => /\+(page|layout)@/.test(f))).toEqual([]);
    expect(pages(routes).length).toBeGreaterThan(0);
  });
});
