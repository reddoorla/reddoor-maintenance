import { parse, HTMLElement } from "node-html-parser";

// Blux hero sliders (`.caslider`) animate through their slides at runtime. The
// settle snapshot freezes whichever slide happened to be active, which is not
// reproducible across re-freezes. Pin every slider to its first slide: force
// slide 1 visible + in position, hide the rest with `display:none`. Appended
// declarations win (inline-style last-wins), so the first slide's own styles are
// preserved and height is unchanged (slide 1 keeps the band's natural height).

/**
 * Make each `.caslider` show only its first slide, deterministically.
 */
export function pinSliders(html: string): string {
  const root = parse(html);

  for (const slider of root.querySelectorAll(".caslider")) {
    const slides = slider.childNodes.filter((n): n is HTMLElement => n instanceof HTMLElement);
    slides.forEach((slide, i) => {
      const style = slide.getAttribute("style") ?? "";
      const pin = i === 0 ? "display:block;transform:translateX(0%);opacity:1" : "display:none";
      slide.setAttribute("style", style ? `${style};${pin}` : pin);
    });
  }

  return root.toString();
}
