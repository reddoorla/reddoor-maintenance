import { describe, it, expect } from "vitest";
import { extractTextRuns, validateCoverage } from "../../src/blux/validate.js";

describe("extractTextRuns", () => {
  it("pulls normalized visible text runs, dropping script/style/head", () => {
    const html = `
      <head><title>ignored</title></head>
      <style>.x{color:red}</style>
      <body>
        <h1>The Pointe</h1>
        <script>var x = "hidden"</script>
        <p>Renew and recover.</p>
      </body>`;
    const runs = extractTextRuns(html);
    expect(runs).toContain("the pointe");
    expect(runs).toContain("renew and recover");
    expect(runs).not.toContain("hidden");
    expect(runs.some((r) => r.includes("color"))).toBe(false);
  });

  it("decodes entities and folds punctuation/case so matching is robust", () => {
    const runs = extractTextRuns("<p>CBRE &amp; Co. &#8212; Leasing</p>");
    // "&" and the em-dash collapse to word boundaries; case folds
    expect(runs).toContain("cbre co leasing");
  });

  it("drops runs with no real word (whitespace, lone punctuation, tiny)", () => {
    const runs = extractTextRuns("<p>   </p><span>·</span><b>ok</b><i>a</i>");
    expect(runs).not.toContain("");
    expect(runs).not.toContain("·");
    // single-letter runs are noise
    expect(runs).not.toContain("a");
  });
});

describe("validateCoverage", () => {
  const exportHtml = `<body>
    <h1>The Pointe</h1><h2>Burbank</h2>
    <p>The Space</p><p>Renew and recover here.</p>
  </body>`;

  it("scores every export text run present in the rendered output", () => {
    const rendered = `<main>
      <section><div>The Pointe</div></section>
      <section>The Space</section>
      <section>Renew and recover here.</section>
    </main>`;
    const r = validateCoverage(exportHtml, rendered);
    expect(r.total).toBe(4);
    expect(r.covered).toBe(3);
    expect(r.missing).toEqual(["burbank"]); // hero eyebrow never rendered
    expect(r.coveragePct).toBe(75);
  });

  it("reports full coverage when the render carries every run", () => {
    const rendered = `<main>The Pointe Burbank The Space Renew and recover here.</main>`;
    const r = validateCoverage(exportHtml, rendered);
    expect(r.covered).toBe(4);
    expect(r.missing).toEqual([]);
    expect(r.coveragePct).toBe(100);
  });
});
