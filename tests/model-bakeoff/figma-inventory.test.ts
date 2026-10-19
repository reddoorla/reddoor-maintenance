import { describe, it, expect } from "vitest";
import * as task from "../../scripts/model-bakeoff/tasks/figma-inventory.mjs";
import { validateRun } from "../../scripts/model-bakeoff/lib/arms.mjs";
import { scoreRun } from "../../scripts/model-bakeoff/lib/score.mjs";

const { inventory, layerName, parseMetadata, parseDesignContext } = task;

// A miniature of the frozen Figma output: one page frame with a visible band that holds a
// hidden layer, a band whose texts come from a component, and a hidden band.
const METADATA = [
  '<frame id="1:1" name="Page" x="0" y="0" width="1440" height="900">',
  '  <frame id="1:2" name="Hero &amp; Intro" x="0" y="0" width="1440" height="500.6">',
  '    <instance id="1:3" name="RI Logo  Garnet " x="0" y="0" width="10" height="10" />',
  '    <frame id="1:4" name="old" x="0" y="0" width="10" height="10" hidden="true">',
  '      <instance id="1:5" name="button light" x="0" y="0" width="10" height="10" />',
  "    </frame>",
  '    <instance id="1:6" name="button light" x="0" y="0" width="10" height="10" />',
  "  </frame>",
  '  <frame id="1:7" name="Properties" x="0" y="500" width="1440" height="300">',
  '    <instance id="1:12" name="slideshow" x="0" y="0" width="1440" height="300" />',
  "  </frame>",
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
  "      </div>",
  '      <div data-node-id="1:7">',
  '        <Slideshow className="shrink-0" />',
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
        name: "Properties",
        type: "frame",
        height: 300,
        texts: 1,
        images: 1,
        instances: ["slideshow"],
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
    ]);
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
      ["1:8", true],
    ]);
    expect(root.children[0]?.name).toBe("Hero & Intro");
  });

  it("parses each component's JSX and the asset constants", () => {
    const dc = parseDesignContext(CODE);
    expect(Object.keys(dc.components).sort()).toEqual(["Page", "Slideshow"]);
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
    // 2 slices x (6 fields + present) + 5 fields x (4 fields + present) + 2 well-formed
    expect(total).toBe(2 * 7 + 5 * 5 + 2);
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
