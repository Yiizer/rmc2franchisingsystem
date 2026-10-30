# Implemented Plan: Workspace Refinements & Historical Client Directory

Implemented October 20, 2026. See UI_WORKSPACE_REDESIGN.md for validation, data reconciliation and rollback instructions.

Original discussion draft follows for traceability: Historical accounts belong in the Client Directory and matches against new inquiries must be flagged for review, never automatically declined solely because of historical data. Implementation and local import were subsequently authorized by the user. Employee false-match clearance with a required reason and supervisor approval for same-client agent changes are confirmed. Remaining hold and layout decisions are listed below.

---

## 1. Decline Request Placement (Image 1)
- **Problem:** Currently, "Close this request" is inside an accordion dropdown placed right under the Client Protection banner, before the submitted form details.
- **Solution:**
  - Remove the top collapsible dropdown from `ClientProtectionPanel`.
  - Add a dedicated footer section at the bottom of the form review card (`ops-ws-summary` in `app/operations-workspace.tsx`).
  - Layout: Left side shows helper text `"Need to decline or archive this request?"`, and right side displays an outlined red button `Decline request`.
  - Clicking `Decline request` triggers the confirmation modal with reasons as before, cleanly archiving the inquiry.

---

## 2. Template Selection & AI Advice Layout (Image 2)
- **Problem:** The AI Template Advisor occupies a large, disruptive section *above* the Suggested Templates, displacing the cards.
- **Solution:**
  - In `app/operations-workspace-templates.tsx`:
    - Move **Suggested Templates** to the very top.
    - Provide a prominent `"View all templates"` toggle/button right beside or below the recommendations.
    - Convert the AI recommendation into a compact **comment bubble** placed *below* the suggested template grid.
    - The bubble displays a single verdict line (e.g. "Matches known requirements"), concise bullet reasons, and an optional dismiss button (`✕`), leaving the template cards stable and unshifted.

---

## 3. Proposal Details Scrolling & Dock Layout (Image 3)
- **Problem:** The left sidebar in the proposal editor (`ProposalDocumentEditor`) has an inner scrollbar with a floating bottom action dock (`Save changes`, `Update preview`, `AI proposal checker`) that obscures field inputs.
- **Solution:**
  - In `app/operations-document-editor.tsx` and `app/operations-document-controls.css`:
    - Eliminate the inner scroll container (`.ops-doc-fields-scroll` overflow constraint).
    - Allow the form fields to render naturally top-to-bottom. The main window/page scrolls smoothly.
    - Place the action buttons (`Save changes`, `Update preview`, `AI proposal checker`) in a clean section directly **at the end of the field list**, rather than floating on top of inputs.
    - Keep the right-hand PDF preview pinned and visible while scrolling through details.

---

## 4. "Resolve the Client Match" Redesign (Image 4)
- **Problem:** The duplicate comparison is confusing: tiny "Match" tags, no indication of differences (especially for different agents), no status of the existing inquiry, and employees are blocked without supervisor access.
- **Solution:**
  - In `app/operations-client-comparison.tsx` and `app/operations-client-protection.tsx`:
    - **Header sentence:** Display a prominent plain-language explanation:
      > *"This client is already registered to **[Existing Agent]** ([Existing ID], [Status], [Protection Status]). This request was submitted by **[New Agent]**."*
    - **Comparison Table:** Clearly badge comparison rows as **Same**, **Different**, or **Not supplied**. Missing values must not be presented as a confirmed difference.
    - **"What do you want to do?" Action Guide:**
      1. **Same client, wrong agent?** → *Decline request* (with explanation).
      2. **Same client, agent change requested (including BOR)?** → *Request supervisor approval*. Employees may collect and verify supporting documents, but the transfer takes effect only after supervisor approval.
      3. **Not the same client? (False match)** → *Confirm different clients*.
    - **Employee Self-Service — confirmed:** Employees may clear obvious false matches using **Confirm different clients**, with a required, non-blank reason explaining why the records represent different clients. Record the employee, timestamp, reason, and specific matched records. Clear only the reviewed match; other unresolved matches and independent restrictions remain in place.
    - **Agent reassignment — confirmed:** If it is the same client and the agent would change, supervisor approval is required, including BOR-backed transfers and reassignment after expiry. False-match clearance must not be used to change ownership or bypass this approval. Record the requesting employee, proposed previous/new agents, supporting evidence, and supervisor decision. Revalidate ownership and restrictions before applying an approved transfer; pending or rejected requests leave ownership unchanged.
    - Place "Decline request" at the very end of the options list.

---

## 5. Historical Client Directory & Review Matching

### Confirmed direction
- Put historical accounts in **Client Directory**.
- When a new inquiry matches history, show **Historical account found — review required** with an **Open history** button.
- Historical matches must **not automatically decline, archive, transfer ownership, or start/reset a 30-day timer**. This also applies when the historical agent matches the incoming agent.
- Keep these review matches separate from existing operational duplicate, verified ownership, BOR, and expired-client rules. A historical alert must not bypass an independent operational restriction.

### Sources and import preparation
- Primary source: `D:/DOWNLOADS/Group Accounts Status (ORIGINAL).xlsx`.
- Readable reference: `D:/DOWNLOADS/Group_Accounts_Status.md`.
- The Markdown reports 3,592 data rows across 18 sheets; this is **not a verified unique-client count**. Reconcile the import totals against original worksheet rows, excluding headers and legends.
- Preserve original workbook, sheet, row, raw values, status text, fill colors, remarks, and source date labels. Do not overwrite the source files.
- Source sheets represent different events: inquiries, proposals, MOAs, SOAs, logistics, and completed accounts. Preserve those categories instead of turning every row into a new inquiry.
- Repeated rows and cross-sheet account names require review. Link related history without silently merging ambiguous clients or discarding source rows.
- Colors are evidence, not definitive status rules: red cells also occur beside on-hold and waiting-for-presentation remarks. Unknown or conflicting statuses remain marked for review.
- Parse dates according to their source meaning (request, sent, closed, enrolled). Saved Age of Account values are snapshots and cannot establish protection expiry.
- Review malformed headers, including apparent account names in header positions, before deciding whether they represent records.
- Provide a dry-run import report with accepted, repeated, ambiguous, and invalid rows. Make imports repeat-safe with import-batch and source-row identifiers. Keep source observations separate from reviewed client identities.

### Directory experience
- Search account, agent, and branch; filter by source category and reviewed status.
- Use server-side pagination. Label counts as historical records versus reviewed clients so totals are not misleading.
- Open an account to see associated history, agents, plans, dates with their meanings, remarks, and source references.
- Apply existing access controls to the directory and source details; do not expose the confidential workbook as a public download.

### Matching and review
- Match normalized account names, and person names only where a source column actually identifies a client/contact. Agent names are context, not proof that two clients are the same.
- Show the matching fields, historical agent, source category, date meaning, status uncertainty, and link to the relevant directory records.
- Proposed review outcomes: confirmed same client, confirmed different clients, or needs further verification. Record reviewer, timestamp, explanation, and affected historical records.
- Confirming the same client links history; it does not by itself assign current ownership or prove a current 30-day entitlement.
- **Confirmed review permissions:** Employees may clear obvious historical false matches with a required reason and a record-specific audit trail. Same-client agent changes require supervisor approval, including cases involving historical records or BOR evidence; historical data alone still does not establish current ownership.
- **Implemented behavior:** historical matches are advisory review flags. Explicit same-client agent-change requests pause processing until supervisor resolution; rejected or stale approvals cannot activate the new agent. Historical matches alone do not decline or archive an inquiry.

---

## 6. Sent Proposal Handler Display on Dashboard & Lists
- **Problem:** When an inquiry is "Sent", the subtitle says generic `"View sent proposal"` and the handler column shows `"—"`.
- **Solution:**
  - In `app/operations-app.tsx` (`nextAction` function):
    - When `record.status === 'Sent'`, resolve the sender/submitter from `record.submissions.at(-1)?.submittedBy` or `record.handledBy`.
    - Display `"Sent by [Staff Name]"` (e.g., `"Sent by Cryssa"`, `"Sent by Judy"`, or `"Sent by Jefferson"`) instead of `"View sent proposal"`.
    - Map staff IDs to readable names using the `users` list.

---

## 7. Duplicate Rule Fix
- **Problem:** Sent/completed inquiries (e.g. `INQ-2026-00138`) currently get flagged as duplicate if a newer inquiry arrives with similar details.
- **Solution:**
  - In `lib/operations/client-rules.ts`:
    - Enforce that **only the newer request** is ever flagged as duplicate, and only when comparing against an older registration.
    - Inquiries that are already in terminal/progressed states (`Sent`, `Awaiting approval`, `Approved`) can **never** be placed on hold as a duplicate by a subsequent request.
    - A newer incoming request never retroactively holds an existing older inquiry.

---

## Proposed Execution Order
1. **Confirm remaining decisions:** historical review holds and editor scrolling tradeoff. Reviewer permissions are confirmed below.
2. **Rule & Data Engine:** Fix retroactive duplicate holds while preserving existing protection and transfer rules; implement reason-required employee false-match clearance and supervisor-only approval for same-client agent changes, including BOR transfers.
3. **Historical Data:** Prepare a reviewed dry-run import from the original XLSX, preserving provenance and ambiguity; connect historical review flags separately from automatic operational decline rules.
4. **Sidebar & Directory Page:** Add "Client Directory" navigation, API route, and table view.
5. **Form Review & Decline (Image 1):** Relocate Decline Request to the bottom footer of Step 0.
6. **Template Selection (Image 2):** Put Suggested Templates first, add "View all templates", and style AI advice as a comment bubble.
7. **Proposal Editor Layout (Image 3):** Remove sidebar inner scroll and move actions to the bottom of the field list.
8. **Client Match Resolution (Image 4):** Implement the clear sentence, Same/Different table, and guided decision options.
9. **Sent Handler Label:** Update `nextAction` in `app/operations-app.tsx` to render `"Sent by [Staff Name]"`.
10. **Verification:** Test all 7 screens and workflows with browser testing and regression scripts.


## Discussion points and implementation safeguards
- **Template advice:** keep suggested cards first and the full library behind View all templates. The compact advisor below cards must still have an explicit check action, a way to reopen dismissed advice, and stale-result labeling. Current advice is simulated/local; do not imply paid AI runs automatically.
- **Editor controls:** removing the inner field scroll means save/check buttons at the end will not always be visible. Confirm this tradeoff against the earlier always-visible-controls requirement. Keep PDF scrolling independent on desktop and stack sensibly on mobile.
- **Sent attribution:** do not equate submittedBy with the person who sent the email. Prefer verified Prepared by / Approved by / Sent by events and dates; show unknown when the actual sender is unavailable. Historical staff aliases need review rather than automatic account assignment.
- **Duplicate chronology:** prevent a later request from retroactively holding the earlier registration, but avoid a blanket exemption for every Awaiting approval or Approved record. Preserve existing legitimate holds, BOR transfers, and identity-specific exceptions.
- **Validation:** test historical same-agent and different-agent matches without automatic decline; repeated import; conflicting colors/dates; missing identity; multiple possible matches; reviewed exceptions; independent live-system duplicates; access controls; and unchanged 30-day timers. Use isolated data before importing into the working database.

- **Permission validation:** verify employees can clear an individual false match only with a non-blank reason; unrelated matches remain unresolved. Verify employees cannot directly transfer same-client ownership, including through BOR or false-match endpoints. Test supervisor approval/rejection, stale ownership at approval time, and complete audit records. Enforce these rules on the server as well as in the interface.
