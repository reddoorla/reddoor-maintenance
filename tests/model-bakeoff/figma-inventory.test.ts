import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as task from "../../scripts/model-bakeoff/tasks/figma-inventory.mjs";
import { validateRun } from "../../scripts/model-bakeoff/lib/arms.mjs";
import { scoreRun } from "../../scripts/model-bakeoff/lib/score.mjs";

const { inventory, layerName, parseMetadata, parseDesignContext } = task;

// A miniature of the frozen Figma output: one page frame with a visible band that holds
// hidden layers (one hidden only through its grandparent), a band whose texts and images come
// from components, an instance band with an instance inside it, and a hidden band. The hidden
// instances' names appear nowhere else, so a reader that kept them would list them.
const METADATA = [
  '<frame id="1:1" name="Page" x="0" y="0" width="1440" height="900">',
  '  <frame id="1:2" name="Hero &amp; Intro" x="0" y="0" width="1440" height="500.6">',
  '    <instance id="1:3" name="RI Logo  Garnet " x="0" y="0" width="10" height="10" />',
  '    <frame id="1:4" name="old" x="0" y="0" width="10" height="10" hidden="true">',
  '      <instance id="1:5" name="hidden button" x="0" y="0" width="10" height="10" />',
  '      <frame id="1:16" name="inner" x="0" y="0" width="10" height="10">',
  '        <instance id="1:17" name="deep hidden button" x="0" y="0" width="10" height="10" />',
  "      </frame>",
  "    </frame>",
  '    <instance id="1:6" name="button light" x="0" y="0" width="10" height="10" />',
  "  </frame>",
  '  <frame id="1:7" name="Properties #1" x="0" y="500" width="1440" height="300">',
  '    <instance id="1:12" name="slideshow" x="0" y="0" width="1440" height="300" />',
  "  </frame>",
  '  <instance id="1:13" name="navbar" x="0" y="0" width="1440" height="80">',
  '    <instance id="1:14" name="menu button" x="0" y="0" width="20" height="20" />',
  "  </instance>",
  '  <frame id="1:8" name="Hidden band" x="0" y="800" width="1440" height="100" hidden="true" />',
  "</frame>",
].join("\n");

const CODE = [
  'const imgPhoto = "https://www.figma.com/api/mcp/asset/a.png";',
  'const imgLogo = "https://www.figma.com/api/mcp/asset/b.svg";',
  "",
  "function Slideshow({ className }: Props) {",
  "  return (",
  '    <div className={className || "flex"} data-node-id="2:1">',
  '      <img alt="" src={imgPhoto} />',
  '      <ul className="list-disc" data-node-id="2:2">',
  '        <li className="ms-[21px]"><span>One &amp; two</span></li>',
  "        <li><span>Three</span></li>",
  "      </ul>",
  "    </div>",
  "  );",
  "}",
  "",
  "function Photo() {",
  "  return (",
  '    <div data-node-id="3:1">',
  '      <img alt="" src={imgPhoto} />',
  "    </div>",
  "  );",
  "}",
  "",
  "export default function Page() {",
  "  return (",
  '    <div className="flex" data-node-id="1:1" data-name="Page">',
  '      <div className="h-[500px]" data-node-id="1:2" data-name="Hero">',
  '        <div data-node-id="1:3"><img alt="" src={imgLogo} /></div>',
  '        <p className="text-[66px]" data-node-id="1:9">',
  "          {`San Antonio's best `}",
  "          <br aria-hidden />",
  "          Since 1983.",
  "        </p>",
  '        <div data-node-id="1:6" data-name="button light">',
  '          <p data-node-id="I1:6;9:9">Contact us</p>',
  "        </div>",
  '        <div className="whitespace-pre-wrap" data-node-id="1:10">',
  '          <p className="mb-0">First paragraph.</p>',
  '          <p className="mb-0">\u200b</p>',
  "          <p>Second paragraph.</p>",
  "        </div>",
  '        <a className="underline" href="https://example.com/a.pdf" data-node-id="1:11" target="_blank">',
  "          Read the notice",
  "        </a>",
  '        <img alt="" src={imgPhoto} />',
  '        <p data-node-id="1:15">\u200b</p>',
  "      </div>",
  '      <div data-node-id="1:7">',
  '        <Slideshow className="shrink-0" />',
  "        <Photo />",
  "        <Photo />",
  "      </div>",
  '      <div data-node-id="1:13">',
  '        <p data-node-id="I1:13;5:5">Menu</p>',
  "      </div>",
  "    </div>",
  "  );",
  "}",
].join("\n");

const frozen = (tool: string, nodeId: string, text: string) => ({
  tool,
  input: { fileKey: "K", nodeId },
  text: [text, "IMPORTANT: a trailer the connector appends"],
});
const META = frozen("get_metadata", "1:1", METADATA);
const DC = frozen("get_design_context", "1:1", CODE);

describe("figma-inventory truth", () => {
  it("lists the page frame's visible children as slices, with their visible instances", () => {
    const inv = inventory(META, DC);
    expect(inv.slices).toEqual([
      {
        id: "1:2",
        name: "Hero & Intro",
        type: "frame",
        height: 501,
        texts: 4,
        images: 1,
        instances: ["RI Logo Garnet", "button light"],
      },
      {
        id: "1:7",
        name: "Properties #1",
        type: "frame",
        height: 300,
        texts: 1,
        images: 3,
        instances: ["slideshow"],
      },
      {
        id: "1:13",
        name: "navbar",
        type: "instance",
        height: 80,
        texts: 1,
        images: 0,
        instances: ["menu button"],
      },
    ]);
  });

  it("takes a field from each deepest text-bearing node, a component's texts going to the slice that uses it", () => {
    const inv = inventory(META, DC);
    expect(inv.fields).toEqual([
      { id: "1:9", slice: "1:2", tag: "p", text: "San Antonio's best\nSince 1983.", href: "" },
      { id: "I1:6;9:9", slice: "1:2", tag: "p", text: "Contact us", href: "" },
      {
        id: "1:10",
        slice: "1:2",
        tag: "div",
        text: "First paragraph.\n\u200b\nSecond paragraph.",
        href: "",
      },
      {
        id: "1:11",
        slice: "1:2",
        tag: "a",
        text: "Read the notice",
        href: "https://example.com/a.pdf",
      },
      { id: "2:2", slice: "1:7", tag: "ul", text: "One & two\nThree", href: "" },
      { id: "I1:13;5:5", slice: "1:13", tag: "p", text: "Menu", href: "" },
    ]);
  });

  const refuses = (code: string, why: RegExp) =>
    expect(() => inventory(META, frozen("get_design_context", "1:1", code))).toThrow(why);

  it("refuses JSX it cannot read rather than score its source text", () => {
    refuses(CODE.replace("Since 1983.", "{label}"), /cannot read the expression/);
    refuses(CODE.replace("Since 1983.", "{/* note */}"), /cannot read the expression/);
    refuses(CODE.replace("<Photo />", "<Card />"), /<Card> is not a function/);
    refuses(CODE.replace("src={imgLogo}", "src={imgMissing}"), /src is not one of the asset/);
    refuses(CODE.replace('href="https://example.com/a.pdf"', "href={url}"), /href=\{url\}/);
    refuses(CODE.replace("Read the notice", "Rock &mdash; roll"), /unknown entity &mdash;/);
    refuses(CODE.replace("{`San Antonio's best `}", "{`Hi ${name}`}"), /interpolation or escape/);
    refuses(CODE.replace("{`San Antonio's best `}", '{"a\\nb"}'), /interpolation or escape/);
  });

  it("keeps a template literal's own spaces between literals", () => {
    const code = CODE.replace("{`San Antonio's best `}", "{`a `}{`b`}");
    const f = inventory(META, frozen("get_design_context", "1:1", code)).fields[0];
    expect(f?.text).toBe("a b\nSince 1983.");
  });

  it("reads single-quoted asset constants", () => {
    const code = CODE.replace(
      'const imgPhoto = "https://www.figma.com/api/mcp/asset/a.png";',
      "const imgPhoto = 'https://www.figma.com/api/mcp/asset/a.png';",
    );
    expect(inventory(META, frozen("get_design_context", "1:1", code)).slices[1]?.images).toBe(3);
  });

  it("refuses a field rendered more than once, which the prompt does not cover", () => {
    refuses(
      CODE.replace("        <Photo />\n", "        <Slideshow />\n"),
      /2:2 is rendered more than once/,
    );
  });

  it("refuses metadata it cannot read", () => {
    const xml = METADATA.replace(
      '<instance id="1:14" name="menu button" x="0" y="0" width="20" height="20" />',
      "<instance id='1:14' name='menu button' />",
    );
    expect(() => inventory(frozen("get_metadata", "1:1", xml), DC)).toThrow(/cannot read/);
  });

  it("refuses frozen output whose slices disagree between the two tools", () => {
    const other = frozen(
      "get_design_context",
      "1:1",
      CODE.replace('data-node-id="1:2"', 'data-node-id="1:99"'),
    );
    expect(() => inventory(META, other)).toThrow(/slices differ/);
  });

  it("parses the metadata tree with hidden flags and decoded names", () => {
    const root = parseMetadata(METADATA);
    expect(root.id).toBe("1:1");
    expect(root.children.map((c) => [c.id, c.hidden])).toEqual([
      ["1:2", false],
      ["1:7", false],
      ["1:13", false],
      ["1:8", true],
    ]);
    expect(root.children[0]?.name).toBe("Hero & Intro");
  });

  it("parses each component's JSX and the asset constants", () => {
    const dc = parseDesignContext(CODE);
    expect(Object.keys(dc.components).sort()).toEqual(["Page", "Photo", "Slideshow"]);
    expect(dc.main).toBe("Page");
    expect(dc.assets).toEqual({
      imgPhoto: "https://www.figma.com/api/mcp/asset/a.png",
      imgLogo: "https://www.figma.com/api/mcp/asset/b.svg",
    });
  });
});

describe("figma-inventory layer names", () => {
  it("trims and collapses a layer name's whitespace and nothing else", () => {
    expect(layerName("  RI Logo  Garnet ")).toBe("RI Logo Garnet");
    expect(layerName("Value Prop #1")).toBe("Value Prop #1");
  });

  it("scores layer names by whitespace and case only, so '#1' still counts", () => {
    const layer = task.kinds.layer;
    expect(layer("RI Logo Garnet ")).toBe(layer("ri logo  garnet"));
    expect(layer("Value Prop #1")).not.toBe(layer("Value Prop 1"));
  });
});

describe("figma-inventory scorer", () => {
  const truth = inventory(META, DC);
  const total = scoreRun(task, truth, truth).length;

  it("scores the truth against itself as perfect", () => {
    const checks = scoreRun(task, truth, truth);
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    // 3 slices x (6 fields + present) + 6 fields x (4 fields + present) + 2 well-formed
    expect(total).toBe(3 * 7 + 6 * 5 + 2);
  });

  it("fails exactly the one check whose field was dropped", () => {
    const perturbed = structuredClone(truth);
    delete (perturbed.fields[3] as Record<string, unknown>).href;
    const bad = scoreRun(task, truth, perturbed).filter((c) => !c.ok);
    expect(bad.map((c) => c.check)).toEqual(["fields 1:11 / href"]);
  });

  it("fails exactly the one check whose value was changed", () => {
    const perturbed = structuredClone(truth);
    perturbed.slices[0]!.instances = ["RI Logo Garnet"];
    const bad = scoreRun(task, truth, perturbed).filter((c) => !c.ok);
    expect(bad.map((c) => c.check)).toEqual(["slices 1:2 / instances"]);
  });
});

describe("figma-inventory collections", () => {
  const truth = inventory(META, DC);
  const failed = (edit: (t: typeof truth) => void) => {
    const p = structuredClone(truth);
    edit(p);
    return scoreRun(task, truth, p)
      .filter((c) => !c.ok)
      .map((c) => c.check);
  };

  it("scores names and instances as layer names: spacing and case fold, '#1' does not", () => {
    expect(failed((t) => (t.slices[1]!.name = "  properties   #1 "))).toEqual([]);
    expect(failed((t) => (t.slices[1]!.name = "Properties 1"))).toEqual(["slices 1:7 / name"]);
    expect(failed((t) => (t.slices[0]!.instances = ["ri logo garnet", "BUTTON  LIGHT"]))).toEqual(
      [],
    );
    expect(failed((t) => (t.slices[1]!.instances = ["slide-show"]))).toEqual([
      "slices 1:7 / instances",
    ]);
  });
});

describe("figma-inventory truth over a run folder", () => {
  const second = {
    meta: '<frame id="5:1" name="Other"><frame id="5:2" name="Band" height="40" /></frame>',
    code: [
      "export default function Other() {",
      "  return (",
      '    <div data-node-id="5:1">',
      '      <div data-node-id="5:2"><p data-node-id="5:3">Hi</p></div>',
      "    </div>",
      "  );",
      "}",
    ].join("\n"),
  };
  const folder = (pages: Record<string, [unknown, unknown?]>) => {
    const dir = mkdtempSync(join(tmpdir(), "figma-inventory-"));
    mkdirSync(join(dir, "figma"));
    for (const [node, [m, d]] of Object.entries(pages)) {
      writeFileSync(join(dir, "figma", `metadata-${node}.json`), JSON.stringify(m));
      if (d) writeFileSync(join(dir, "figma", `design-context-${node}.json`), JSON.stringify(d));
    }
    return dir;
  };

  it("joins every page frame in the folder, in file order", () => {
    const dir = folder({
      "1-1": [META, DC],
      "5-1": [
        frozen("get_metadata", "5:1", second.meta),
        frozen("get_design_context", "5:1", second.code),
      ],
    });
    const t = task.truth(dir);
    expect(t.slices.map((s) => s.id)).toEqual(["1:2", "1:7", "1:13", "5:2"]);
    expect(t.fields.at(-1)).toEqual({ id: "5:3", slice: "5:2", tag: "p", text: "Hi", href: "" });
  });

  it("refuses a component whose fields repeat on a second page", () => {
    const dup = frozen(
      "get_design_context",
      "5:1",
      second.code.replace('<p data-node-id="5:3">Hi</p>', '<p data-node-id="2:2">Hi</p>'),
    );
    const dir = folder({
      "1-1": [META, DC],
      "5-1": [frozen("get_metadata", "5:1", second.meta), dup],
    });
    expect(() => task.truth(dir)).toThrow(/2:2 is rendered more than once/);
  });

  it("names the missing half of a page, and --root when the folder is empty", () => {
    expect(() => task.truth(folder({ "1-1": [META] }))).toThrow(/no design-context-1-1\.json/);
    expect(() => task.truth(folder({}))).toThrow(/--root/);
  });

  it("copies both files of each page and nothing else", () => {
    const [source] = task.sources;
    const names = [
      "metadata-6802-1416.json",
      "design-context-6802-1416.json",
      "notes.json",
      "metadata-6802-1416.json.bak",
    ];
    expect(names.filter((n) => source!.match.test(n))).toEqual(names.slice(0, 2));
  });
});

describe("figma-inventory arms", () => {
  it("runs Haiku at low and medium and Sonnet at medium twice each, with an Opus high gold", () => {
    expect(validateRun(task.arms, task.gold)).toEqual([]);
    expect(task.arms.map((a) => `${a.model}@${a.effort}`)).toEqual([
      "haiku@low",
      "haiku@low",
      "haiku@medium",
      "haiku@medium",
      "sonnet@medium",
      "sonnet@medium",
    ]);
    expect(task.gold).toEqual({ id: "gold", model: "opus", effort: "high" });
  });

  it("is refused when an arm has no effort", () => {
    const arms = task.arms.map((a, i) => (i === 0 ? { id: a.id, model: a.model } : a));
    expect(validateRun(arms, task.gold).join("\n")).toMatch(/haiku-low-1 has no effort/);
  });
});
