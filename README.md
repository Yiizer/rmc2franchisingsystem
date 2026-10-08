# RMC2 Insurance Operations — clickable prototype

A client-demo prototype branded with the supplied RMC2 logo, navy, orange and white palette.

## Open and demo
The initial screen is the Employee Dashboard. Use **Preview as team member** to switch among the five franchising personnel and a demo administrator. Divisions indicate primary responsibility; coordinators can prepare and send colleagues’ inquiries through Team Inquiries. The sign-out icon opens the demo Login screen. No password or real authentication is used.

Suggested walkthrough:
1. Open Sampaguita National High School (demo) or click **Simulate Gmail inquiry**.
2. Open the sample attachments, run extraction, enter the missing start date, verify the account profile and mark account availability as Available.
3. Review up to three eligible fictional products and accept a recommendation. An alternative requires a selection reason.
4. Edit the proposal notes, choose a template, download a sample PDF and submit for approval.
5. Switch to Emerson Dolf Fernandez, open the Approval Queue, and approve, return with notes, or reject.
6. For a returned proposal, switch to Employee and start a revised version.
7. After approval, switch to Employee, preview the final email and PDF attachments, and simulate sending.
8. Open History and the inquiry audit trail.

Admin includes editable Users & Roles, Products & Rules, Templates, integration plans, and analytics/monitoring. The reset action restores the initial sample dataset.

## Run locally
Requires Node.js 22 or later.
- Install: npm ci
- Start development: npm run dev
- Open http://127.0.0.1:5173
- Build: npm run build
- Static output: out/

Stack: Next.js 16, React 19, TypeScript, Tailwind 4, shadcn-style Radix primitives, Lucide icons and Sonner notifications. Dependencies from the provided starter are retained.

## Prototype boundaries
All clients, insurance products, prices, recommendations, processing and email delivery are fictional. There are no live Gmail, OpenAI or Supabase calls and no collected credentials. Files are sample previews. PDF downloads are simple, genuine PDF documents; the on-screen branded preview is more visually detailed than the downloadable sample.

Changes persist only in the current browser with localStorage. Demo role switching is not access control. This prototype should not receive real client or health information. An approved proposal retains its selected product data and chosen template introduction.

AreaId, territoryId and ownerId are reserved on inquiry records. Assignments are manual, and no territory-routing policy is assumed.

## Production architecture direction
- Vercel: deploy the Next.js application; replace this static demo configuration when adding server endpoints.
- Supabase: authenticated users, role and record authorization, PostgreSQL inquiry/product/proposal/audit tables, private document storage.
- Gmail API: OAuth-connected mailbox, notification intake, durable background processing, deduplication with Gmail message/thread IDs, approved-version send and delivery history.
- OpenAI: server-side extraction and structured recommendations grounded in approved product rules, with human verification.
- Proposal versions: immutable documents and snapshots, supervisor decisions, controlled sending and durable audit events.
- Area routing: configure separately after business rules are agreed.

## Validation
Passed TypeScript checking and the production Next.js build. A browser walkthrough verified extraction gates, product selection, revision, approval, PDF download, simulated send/archive, admin navigation, login and mobile overflow without runtime errors.
A feature-detected WebMCP navigation tool is included; native WebMCP validation is unavailable in the local browser.

Source map:
- app/page.tsx — role navigation, dashboard, inquiry lists, history, notifications, analytics and state.
- app/franchise-workspace.tsx — inquiry, extraction, recommendations, proposal, approval and email flow.
- app/admin.tsx — editable demo administration.
- app/model.ts — types, fictional records and PDF generation.
- app/globals.css — responsive RMC2 theme.
- public/rmc2-logo.png — supplied brand logo.


## Task importance and attention
Urgency is separate from workflow status. Amber identifies priority attention, missing information or review needed. Red is reserved for small revision badges. Blue identifies draft/product work, green identifies ready or completed work, and slate identifies waiting or closed work. Rows and summary cards use mostly neutral surfaces. Labels and icons accompany the colors. The dashboard counts role-owned actions, includes unfinished drafts and unverified records, sorts blocked/high-priority tasks first, and filters each next-step category. Awaiting approval is actionable for supervisors and waiting for employees.

## Franchise form update
The supplied workbook was read to map account, agent, branch, business sector, addressee, payment mode, employee/dependent counts, age ranges and provider preferences. The published sample uses fictional account/contact details and retains separate source snapshots. Closure document requirements are shown separately and do not block drafts. Product eligibility filters group size and sector before ranking; missing budget is not invented. Rates and rules remain illustrative. Emerson has proposal approval permission by default; Zeo has monitoring access. This demonstration policy is editable in Users & Roles pending confirmation.
