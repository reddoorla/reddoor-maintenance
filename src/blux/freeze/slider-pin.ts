import { parse, HTMLElement } from "node-html-parser";

// Blux single-column hero sliders (`.caslider` with `data-columns` 1 or absent)
// animate through their slides at runtime. The settle snapshot freezes whichever
// slide happened to be active, which is not reproducible across re-freezes. Pin
// such a slider to its first slide: force slide 1 visible + in position, hide the
// rest with `display:none`. Appended declarations win (inline-style last-wins),
// so the first slide's own styles are preserved and height is unchanged (slide 1
// keeps the band's natural height).
//
// A MULTI-column slider (`data-columns` >= 2) shows several slides at once — the
// settled snapshot already renders those columns faithfully — so pinning would
// hide the simultaneously-visible columns and regress the band. Leave those
// untouched; the pin is only for the single-column hero case.

/**
 * Pin each single-column `.caslider` to its first slide, deterministically.
 * Multi-column sliders (`data-columns` >= 2) are left as settled.
 */
export function pinSliders(html: string): string {
  const root = parse(html);

  for (const slider of root.querySelectorAll(".caslider")) {
    const columns = parseInt(slider.getAttribute("data-columns") ?? "1", 10) || 1;
    if (columns > 1) continue; // multi-column carousel: keep the settled columns
    const slides = slider.childNodes.filter((n): n is HTMLElement => n instanceof HTMLElement);
    slides.forEach((slide, i) => {
      const style = slide.getAttribute("style") ?? "";
      const pin = i === 0 ? "display:block;transform:translateX(0%);opacity:1" : "display:none";
      slide.setAttribute("style", style ? `${style};${pin}` : pin);
    });
  }

  return root.toString();
}
