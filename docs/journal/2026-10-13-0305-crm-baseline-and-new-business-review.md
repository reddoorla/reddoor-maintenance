## 2026-10-13 — CRM baseline, the new-business build sheet, and three corrections the operator made (reddoor-workspace `c50228b`…`d8c1bd2`; 97(h) closed)

A read-only data job became a new-business review. The deliverables live in the private workspace (`reviews/2026-10-12-reddoor-market-position/`, notes 40–42, `one-pager-builds.md`, `research-plan.md`), not here. This entry is the record of what the session believed, what it measured, and what the operator corrected. The only change in this repo is closing 97(h).

**The CRM baseline (notes/40).** GoHighLevel was read with GET only through `CRM_PAT`, after one location read proved the token pointed at `nluRF7uH234gl3PdTBVD`.

- The first six calls answered 403. That was Cloudflare 1010 refusing Python's default User-Agent, not the token; setting a User-Agent fixed it.
- Contacts: 21, of which 11 are team tests.
- Since the funnel reached `main` (reddoor-website #133, 2026-08-20 10:43 PT), it has produced one real booking.
- No human-sent message to a real contact appears in the CRM.

**Two instruments did not hold.**

- **The contact `source` field** says the last form a contact touched, not where it came from. The one real lead's reads "Status Update (Sales Call)", because someone logged his no-show through that form. `createdBy` from `GET /contacts/{id}` is the instrument for origin.
- **`GET /conversations/messages/export`** returned 80 rows, then 0 rows for the same parameters. Per-conversation listing replaced it.
- One read printed a contact's details into the session transcript. Nothing was written to a file. After that, every read printed enumerated fields only.

**The build sheet, and the bias the operator spotted.** The first sheet listed 12 things Tucker could build. The operator said it looked biased by ideas already in the conversation, and a 36-agent review agreed:

- every item had Tucker as the builder;
- no item had strong evidence that it wins work;
- the sheet was committed 97 seconds after the CRM pull that framed it.

Seven ideators who never saw the sheet converged on one point: the 2025–26 work came through people who already knew the studio, while the 2026 tooling points at strangers. The sheet is now three bets, each with a cost, a stop rule and a rethink rule. Builds wait until a step has worked by hand. A research plan opens by asking Tim and Erik for their own ideas before they see the sheet.

**Beliefs corrected on contact, all three by the operator.**

1. **"Seven Turnstile-only rows read like inquiries."** This came from a keyword match nobody checked. Five were the funnel's own fixed 51-character email-capture message from team tests: `/api/inquiry` sends no Turnstile token by design (reddoor-website `src/routes/api/inquiry/+server.ts:189`), so all 37 inquiry rows are `spam_auto`. The other six were /contact posts with no token. The operator then went further: every post the filter caught was correctly filtered, and only one lead was real. The sheet first said "most of our leads were filtered out" in effect, and was rewritten.
2. **Item 8, "a Turnstile spam check".** It was built on claim 1 and was rewritten when claim 1 fell.
3. **"The lead sat unanswered"**, and the sheet's "that miss is mine". This came from 97(h) here, "reply to or close the lead thread", plus the CRM showing no human message. Both are derived views read as the lead's state, the #711 pattern. The lead was sent the /inquiry link on 09-17 and booked that day, Tim announced it, and someone logged the 09-21 no-show. The workspace's own internal review had already flagged the claim as likely wrong (notes/30, row 13), and the review workflow re-imported it anyway. 97(h) is closed above.

**Measured in passing.**

- reddoor-website `/api/book` posts `formType: "booking"` to central ingest. `SUBMISSION_FORM_TYPES` (`src/forms/types.ts:6-12`) does not include it, so every booking is rejected, and Turso holds 0 booking rows against 8 CRM bookings. A task card to fix this could not be queued (the spawn tool timed out). It is recorded here instead.
- Since 15 July, 42 of 43 production /contact rows are `spam_auto`.

**Honest accounting.** The most useful corrections in this session came from the operator reading the raw rows, not from any agent. Each wrong claim had the same shape: a count, or a silence, from one authority, presented as the state of the world.
