import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import ThemeToggle from "../../src/lib/ThemeToggle.svelte";
import { THEME_KEY } from "../../src/lib/theme.js";

/**
 * P1-78e: the shell's theme toggle cycles system, light and dark, stores the
 * choice per browser, and applies it to <html>. The before-first-paint half is
 * app.html's inline script (style-guide.ssr.test.ts runs it with each stored value).
 */

let target: HTMLElement;
let app: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  target = document.createElement("div");
  document.body.appendChild(target);
});
afterEach(() => {
  if (app) unmount(app);
  app = null;
  target.remove();
});

const button = () => target.querySelector<HTMLButtonElement>("[data-theme-toggle]")!;
const start = () => {
  app = mount(ThemeToggle, { target });
  flushSync();
};
const click = () => {
  button().click();
  flushSync();
};

describe("theme toggle", () => {
  it("starts on system when nothing is stored, and sets no theme", () => {
    start();
    expect(button().textContent).toBe("Theme: system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("cycles system → light → dark → system, storing and applying each", () => {
    start();
    click();
    expect(button().textContent).toBe("Theme: light");
    expect(localStorage.getItem(THEME_KEY)).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    click();
    expect(button().textContent).toBe("Theme: dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    click();
    expect(button().textContent).toBe("Theme: system");
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("reads the stored choice on a new page load, and cycles on from it", () => {
    localStorage.setItem(THEME_KEY, "dark");
    start();
    expect(button().textContent).toBe("Theme: dark");
    click();
    expect(button().textContent).toBe("Theme: system");
  });

  it("still toggles the page when storage refuses", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    try {
      start();
      click();
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});
