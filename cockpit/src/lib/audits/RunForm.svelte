<script lang="ts">
  // The Run form. No polling and no live progress: a run takes minutes and the
  // result arrives by email. The server's `message` is shown as text only.
  let busy = $state(false);
  let statusText = $state("");
  let statusError = $state(false);
  let reportUrl = $state<string | null>(null);

  function field(form: HTMLFormElement, name: string): string {
    const el = form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null;
    return el ? el.value : "";
  }

  async function onsubmit(e: SubmitEvent) {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    statusError = false;
    statusText = "";
    reportUrl = null;
    busy = true;
    try {
      const res = await fetch("/api/prospect-audit/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: field(form, "url").trim(),
          business: field(form, "business").trim(),
          goal: field(form, "goal"),
          terms: field(form, "terms"),
          questions: field(form, "questions"),
        }),
      });
      const data: { message?: string; reportUrl?: string } | null = await res
        .json()
        .catch(() => null);
      statusText =
        data && data.message
          ? data.message
          : res.ok
            ? "Audit started."
            : "Failed to start the audit.";
      if (!res.ok) statusError = true;
      if (data && data.reportUrl) reportUrl = data.reportUrl;
      if (res.ok) form.reset();
    } catch {
      statusError = true;
      statusText = "Failed to start the audit — network error.";
      reportUrl = null;
    } finally {
      busy = false;
    }
  }
</script>

<form id="audit-run-form" class="run-form" {onsubmit}>
  <label
    >URL
    <input type="url" name="url" placeholder="https://example.com" required />
  </label>
  <label
    >Business name (optional)
    <input type="text" name="business" placeholder="Acme Roofing" />
  </label>
  <label
    >Goal
    <select name="goal" required>
      <option value="">What should the site get a visitor to do?</option>
      <option value="book">Book an appointment</option>
      <option value="enquire">Start a project or ask for a quote</option>
      <option value="call">Pick up the phone</option>
      <option value="visit">Come in person</option>
      <option value="buy">Buy something</option>
      <option value="demo">Talk to sales</option>
      <option value="partner">Ask about distribution or partnership</option>
    </select>
  </label>
  <label
    >Search terms (optional — one per line)
    <textarea
      name="terms"
      rows="4"
      placeholder="commercial roof replacement cost San Antonio&#10;TPO roofing contractor for warehouses"
    ></textarea>
  </label>
  <label
    >Buyer questions (optional — one per line)
    <textarea
      name="questions"
      rows="4"
      placeholder="Do you service my postcode?&#10;How fast can you come out?"></textarea>
  </label>
  <p class="run-note">
    Leave either blank and the audit chooses its own, as it does today. Fixed terms are what make
    two audits of the same site comparable.
  </p>
  <button type="submit" disabled={busy}>{busy ? "Starting…" : "Run audit"}</button>
  <div
    id="audit-run-status"
    class={statusError ? "run-status is-error" : "run-status"}
    aria-live="polite"
  >
    {statusText}{#if reportUrl}<a href={reportUrl}>View existing report →</a>{/if}
  </div>
</form>
