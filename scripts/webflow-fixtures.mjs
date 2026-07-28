// scripts/webflow-fixtures.mjs — refresh the committed Webflow test fixtures.
// Run manually when the live site changes; tests never hit the network.
import { mkdir, writeFile } from "node:fs/promises";

const BASE = "https://www.beachfrontdentistry.com";
const PAGES = {
  "home.html": "/",
  "our-team.html": "/our-team",
  "services-index.html": "/services",
  "service-dental-crowns.html": "/services/dental-crowns",
  "service-mi-paste.html": "/services/mi-paste", // has a YouTube embed
  "ask-the-doctor.html": "/ask-the-doctor",
  "question-tooth-broke-off.html": "/questions/tooth-broke-off",
  "team-dr-robert-quan.html": "/team-members/dr-robert-quan",
};

await mkdir(new URL("../tests/webflow/fixtures/", import.meta.url), {
  recursive: true,
});
for (const [file, path] of Object.entries(PAGES)) {
  const res = await fetch(BASE + path, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  await writeFile(new URL(`../tests/webflow/fixtures/${file}`, import.meta.url), await res.text());
  console.log("saved", file);
}
