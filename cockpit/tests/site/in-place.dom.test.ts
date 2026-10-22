import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import Page from "../../src/routes/s/[slug]/+page.svelte";
import { buildSiteView, type SiteView } from "../../src/lib/site/view.js";
import { reactive } from "../_helpers/reactive.svelte.js";
import { input, pending, siteRow, type SiteInput } from "./fixtures.js";

/**
 * Review round 5 of the freshness PR: the read after the page's own post is
 * taken in place (no remount), and it can carry a change the post caused, or
 * one another writer made. Controls that set themselves up at mount must follow
 * it: the Approve gate, and a field the operator has nothing of their own in.
 * What the operator did (an action's answer, an unsaved or failed edit) wins.
 */

let target: HTMLElement;
let app: Record<string, unknown> | null = null;

const view = (i: SiteInput): SiteView =>
  JSON.parse(
    JSON.stringify(buildSiteView(i.site, i.reports, i.submissions, i.spam, i.now, i.alarm)),
  ) as SiteView;

function render(i: SiteInput): { data: { view: SiteView } } {
  const props = reactive({ data: { view: view(i) } });
  app = mount(Page, { target, props });
  flushSync();
  return props;
}

beforeEach(() => {
  target = document.createElement("div");
  document.body.append(target);
});
afterEach(() => {
  if (app) unmount(app);
  app = null;
  target.remove();
  vi.unstubAllGlobals();
});

const approve = () =>
  target.querySelector<HTMLButtonElement>('button.approve[data-report-id="rp"]')!;
const contact = () =>
  target.querySelector<HTMLInputElement>("input[data-detail-field='pointOfContact']")!;

describe("a read taken in place", () => {
  it("unblocks Approve once the point of contact it was missing is saved", () => {
    const props = render(
      input({ site: siteRow({ pointOfContact: null }), reports: [pending({ id: "rp" })] }),
    );
    expect(approve().disabled).toBe(true);
    props.data = {
      view: view(
        input({
          site: siteRow({ pointOfContact: "owner@acme.example" }),
          reports: [pending({ id: "rp" })],
        }),
      ),
    };
    flushSync();
    expect(approve().disabled).toBe(false);
    // And the field shows the stored value (it held nothing of the operator's).
    expect(contact().value).toBe("owner@acme.example");
  });

  it("blocks Approve again when the stored gate closes", () => {
    const props = render(input({ reports: [pending({ id: "rp" })] }));
    expect(approve().disabled).toBe(false);
    props.data = {
      view: view(
        input({ site: siteRow({ pointOfContact: null }), reports: [pending({ id: "rp" })] }),
      ),
    };
    flushSync();
    expect(approve().disabled).toBe(true);
  });

  it("leaves Approve to the operator's own action once they have acted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ reason: "send-blocked", blockers: ["recipients: none"] }), {
            status: 409,
          }),
      ),
    );
    const props = render(input({ reports: [pending({ id: "rp" })] }));
    approve().click();
    await vi.waitFor(() => expect(approve().textContent).toBe("Blocked"));
    props.data = {
      view: view(
        input({ site: siteRow({ pointOfContact: null }), reports: [pending({ id: "rp" })] }),
      ),
    };
    flushSync();
    // The refusal's answer stands: enabled for a retry, labelled Blocked.
    expect(approve().textContent).toBe("Blocked");
    expect(approve().disabled).toBe(false);
  });

  it("never writes over what the operator typed", () => {
    const props = render(input({ site: siteRow({ pointOfContact: "old@acme.example" }) }));
    contact().value = "typing@acme.example";
    contact().dispatchEvent(new Event("input", { bubbles: true }));
    props.data = {
      view: view(input({ site: siteRow({ pointOfContact: "new@acme.example" }) })),
    };
    flushSync();
    expect(contact().value).toBe("typing@acme.example");
  });
});
