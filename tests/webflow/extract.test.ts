import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractQuestion, extractService, extractTeamMember } from "../../src/webflow/extract.js";

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf-8");

describe("extractTeamMember", () => {
  it("pulls name, role, bio, photo from a team page", () => {
    const m = extractTeamMember(fx("team-dr-robert-quan.html"), "dr-robert-quan");
    expect(m.name).toBe("Dr. Robert Quan");
    expect(m.role).toBe("Dentist");
    expect(m.bioHtml).toContain("Central Valley");
    expect(m.photo?.url).toContain("/64b1c843b071dc32170ea053/");
    // the headshot, NOT the decorative beach background that precedes it
    expect(m.photo?.url).toContain("Dr-Quan-Headshot");
  });
});

describe("extractService", () => {
  it("pulls title, category, subtitle, body", () => {
    const s = extractService(fx("service-dental-crowns.html"), "dental-crowns");
    expect(s.title).toBe("Dental Crowns");
    expect(s.category).toBe("Restore Your Smile");
    expect(s.subtitle).toMatch(/^Many people put off/);
    expect(s.bodyHtml).toContain("What is a Dental Crown?");
    expect(s.youtubeUrl).toBeUndefined();
    expect(s.hero?.url).toContain("dental-crowns.jpg");
  });

  it("captures the YouTube embed on mi-paste", () => {
    const s = extractService(fx("service-mi-paste.html"), "mi-paste");
    expect(s.youtubeUrl).toContain("youtube.com/embed/");
    expect(s.hero?.url).toContain("mi-paste.jpg");
  });
});

describe("extractQuestion", () => {
  it("pulls title, lead, body", () => {
    const q = extractQuestion(fx("question-tooth-broke-off.html"), "tooth-broke-off", 29);
    expect(q.title).toMatch(/tooth broke off/i);
    expect(q.lead).toMatch(/serious dental problem/);
    expect(q.bodyHtml).toContain("Flush your mouth");
    expect(q.order).toBe(29);
    expect(q.image?.url).toContain("chipped-tooth.jpg");
  });
});

describe("negative paths", () => {
  it("extractTeamMember throws on missing h1, naming the slug", () => {
    expect(() => extractTeamMember("<div></div>", "no-h1")).toThrowError("team no-h1: no h1");
  });

  it("extractTeamMember throws on missing bio container", () => {
    expect(() => extractTeamMember("<h1>Dr. X</h1>", "no-bio")).toThrowError(
      "team no-bio: no .w-richtext bio",
    );
  });

  it("extractService throws naming the missing title selector", () => {
    const html = '<h3 class="service-page-label">Cat</h3><div class="w-richtext"><p>Body</p></div>';
    expect(() => extractService(html, "no-title")).toThrowError(
      "service no-title: no .service-page-title-subtitle-section h2",
    );
  });

  it("extractService throws naming the missing category selector", () => {
    const html =
      '<section class="service-page-title-subtitle-section"><h2>T</h2></section>' +
      '<div class="w-richtext"><p>Body</p></div>';
    expect(() => extractService(html, "no-cat")).toThrowError(
      "service no-cat: no .service-page-label",
    );
  });

  it("extractService throws on missing body container", () => {
    const html =
      '<section class="service-page-title-subtitle-section"><h2>T</h2></section>' +
      '<h3 class="service-page-label">Cat</h3>';
    expect(() => extractService(html, "no-body")).toThrowError(
      "service no-body: no .w-richtext body",
    );
  });

  it("extractQuestion omits lead and image when absent, without throwing", () => {
    const html =
      '<section class="hero"></section><h2 class="heading-30">Q?</h2>' +
      '<div class="dynamic-content-body w-richtext"><p>Body</p></div>';
    const q = extractQuestion(html, "bare", 3);
    expect(q.title).toBe("Q?");
    expect(q.bodyHtml).toContain("Body");
    expect("lead" in q).toBe(false);
    expect("image" in q).toBe(false);
  });

  it("extractQuestion throws on missing body container", () => {
    expect(() => extractQuestion('<h2 class="heading-30">Q?</h2>', "no-body", 0)).toThrowError(
      "question no-body: no .dynamic-content-body.w-richtext",
    );
  });
});
