import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
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

  // Review round 1: a Storage.prototype stub never fired under happy-dom, so this
  // test passed with the try/catch removed. The spy is on the instance, and is
  // asserted to have thrown.
  it("still toggles the page when storage refuses a write", () => {
    const refuse = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    try {
      start();
      click();
      expect(refuse).toHaveBeenCalled();
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
      expect(button().textContent).toBe("Theme: light");
    } finally {
      refuse.mockRestore();
    }
  });

  // Round 3: junk in storage gave the button no label at all.
  it("reads a stored value it does not know as system", () => {
    localStorage.setItem(THEME_KEY, "purple");
    start();
    expect(button().textContent).toBe("Theme: system");
  });

  it("starts on system when reading the stored choice throws", () => {
    const refuse = vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    try {
      localStorage.setItem(THEME_KEY, "dark");
      start();
      expect(refuse).toHaveBeenCalled();
      expect(button().textContent).toBe("Theme: system");
    } finally {
      refuse.mockRestore();
    }
  });

  it("starts on system, and still toggles, when the storage itself cannot be reached", () => {
    const desc = Object.getOwnPropertyDescriptor(window, "localStorage")!;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    try {
      start();
      expect(button().textContent).toBe("Theme: system");
      click();
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    } finally {
      Object.defineProperty(window, "localStorage", desc);
    }
  });
});
