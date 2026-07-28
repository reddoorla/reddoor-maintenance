import { describe, expect, it } from "vitest";
import { irToDocs } from "../../src/webflow/to-docs.js";

const IR = {
  baseUrl: "https://x",
  capturedAt: "2026-07-27T00:00:00Z",
  team: [
    {
      slug: "Dr-Quan",
      name: "Dr. Quan",
      role: "Dentist",
      bioHtml: "<p>Bio</p>",
      photo: { url: "https://cdn/q.jpg" },
    },
  ],
  services: [
    {
      slug: "mi-paste",
      title: "Mi Paste",
      category: "Specialty Services",
      subtitle: "Sub",
      bodyHtml: "<p>Body</p>",
      youtubeUrl: "https://www.youtube.com/embed/x",
    },
  ],
  serviceCategories: [{ name: "Specialty Services", slugs: ["mi-paste"] }],
  questions: [
    { slug: "q-one", title: "Q one?", lead: "Lead", bodyHtml: "<p>A</p>", order: 0 },
    { slug: "q-two", title: "Q two?", lead: "Lead", bodyHtml: "<p>B</p>", order: 1 },
  ],
  reviews: [],
};

describe("irToDocs", () => {
  const docs = irToDocs(IR as never);

  it("lowercases uids and maps types", () => {
    expect(docs.map((d) => [d.type, d.uid])).toEqual([
      ["person", "dr-quan"],
      ["collection_item", "mi-paste"],
      ["news_article", "q-one"],
      ["news_article", "q-two"],
    ]);
  });

  it("person: role rides tags, photo rides the asset placeholder", () => {
    const p = docs[0];
    expect(p?.data.tags).toBe("Dentist");
    expect(p?.data.media).toEqual({ __asset: "q.jpg", alt: "Dr. Quan" });
    expect(p?.data.title).toEqual([{ type: "heading1", text: "Dr. Quan", spans: [] }]);
  });

  it("service: category rides tags, youtube rides link, subtitle leads body", () => {
    const s = docs[1];
    expect(s?.data.tags).toBe("Specialty Services");
    expect(s?.data.link).toEqual({ link_type: "Web", url: "https://www.youtube.com/embed/x" });
    expect((s?.data.body as { text: string }[])[0]?.text).toBe("Sub");
  });

  it("service body is exactly [subtitle paragraph, ...bodyHtml blocks]", () => {
    const body = docs[1]?.data.body as { type: string; text: string }[];
    expect(body).toHaveLength(2);
    expect(body[0]).toEqual({ type: "paragraph", text: "Sub", spans: [] });
    expect(body[1]?.text).toBe("Body");
  });

  it("question body is exactly [lead paragraph, ...bodyHtml blocks]", () => {
    const body = docs[2]?.data.body as { type: string; text: string }[];
    expect(body).toHaveLength(2);
    expect(body[0]).toEqual({ type: "paragraph", text: "Lead", spans: [] });
    expect(body[1]?.text).toBe("A");
  });

  it("absent subtitle/lead leave no stray empty first block in body", () => {
    const ir4 = {
      ...IR,
      team: [],
      services: [{ slug: "s", title: "S", category: "Cat", bodyHtml: "<p>Body</p>" }],
      questions: [{ slug: "q", title: "Q?", bodyHtml: "<p>A</p>", order: 0 }],
    };
    const out = irToDocs(ir4 as never);
    const sBody = out[0]?.data.body as { text: string }[];
    expect(sBody).toHaveLength(1);
    expect(sBody[0]?.text).toBe("Body");
    const qBody = out[1]?.data.body as { text: string }[];
    expect(qBody).toHaveLength(1);
    expect(qBody[0]?.text).toBe("A");
  });

  it("questions: descending synthetic dates preserve order", () => {
    const d2 = docs[2]?.data.date as string;
    const d3 = docs[3]?.data.date as string;
    expect(d2 > d3).toBe(true);
  });

  it("asset placeholder filename stays percent-ENCODED (matches manifest/runMigration)", () => {
    const ir2 = {
      ...IR,
      team: [
        {
          slug: "a",
          name: "A",
          bioHtml: "<p>b</p>",
          photo: { url: "https://cdn/x/logo%3Dwhite.svg" },
        },
      ],
    };
    const out = irToDocs(ir2 as never);
    expect(out[0]?.data.media).toEqual({ __asset: "logo%3Dwhite.svg", alt: "A" });
  });

  it("absent optionals omit the key entirely (exactOptionalPropertyTypes)", () => {
    const ir3 = {
      ...IR,
      team: [{ slug: "a", name: "A", bioHtml: "<p>b</p>" }],
      services: [],
      questions: [],
    };
    const out = irToDocs(ir3 as never);
    expect(out[0] && "media" in out[0].data).toBe(false);
  });
});
