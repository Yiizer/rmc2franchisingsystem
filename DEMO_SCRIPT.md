# Client demo script (2026-11-05)

Online test version: https://rmc2-test-yiizer.vercel.app. All data is fictional. Every email the system sends goes to the
**yiizer17 test inbox**, never to the agent address shown, so keep that inbox open in another tab.

Sign-in passwords are in `test-results/online-credentials/CREDENTIALS.txt` (git-ignored). Never put them on a slide or in chat.

| Account | Role | Use it for |
|---|---|---|
| `cryssa@rmc2.local` | Employee | Main presenter account: importing, preparing |
| `judy@rmc2.local`, `jefferson@rmc2.local` | Employee | Testers; a second colleague to show the handling lock |
| `emerson@rmc2.local`, `zeo@rmc2.local` | Supervisor | Approving and returning (use a laptop, see Known limits) |
| `admin@rmc2.local` | Admin | Users & roles, templates, monitoring, email status |

## Before the meeting (morning of)

1. Open the app once and sign in, so the free database wakes up (the first load can take ~20 s).
2. Open the yiizer17 Gmail inbox in a second tab. Have these two files ready to email from your phone or laptop:
   - `test-results/demo-online/email-these/Franchise-Form-Rizal-Coastal-Foods.xlsx`
   - `test-results/demo-online/email-these/Scanned-Inquiry-Mountain-View-Academy.pdf`
3. For testers: create a **Shareable Link** in Vercel (Project `rmc2-preview` → Deployments → the latest one → **Share**).
   Send each tester the link plus **one** account (two people on the same account works but is confusing).
4. Use **two browser windows** for yourself (one normal, one private) so you can be the employee and the supervisor at once.

## Demo records already in the system

| Client | State | What it shows |
|---|---|---|
| Northstar Logistics Corporation | New inquiry | The full process live (Part 2) |
| Northstar Logistics (2nd agent, Victor Tan) | New inquiry, **on hold** | Duplicate-client protection |
| Lakeside Manufacturing Inc. | Preparing proposal | Draft with a PDF ready; "pick up where you left off" |
| Sunrise Community Multi-Purpose Coop. | Waiting for agent details | Missing ages, details request emailed |
| Bayani Elementary School | Awaiting approval | Supervisor approves live, real email goes out |
| Cedar Digital Services Inc. | Needs correction | Returned by Zeo with a note and a flag |
| Harbor Point Hotel and Suites | Sent | Exact PDF emailed, 30-day protection, a progress report |
| Silverline Trading Co. | Declined | Archives keep everything, with the reason |

The IDs are in `test-results/demo-online/demo-records.json`.

## Running order (about 25 minutes)

**Part 1: the problem and the dashboard (3 min).** Sign in as Cryssa. Dashboard: counts per status, what needs attention,
shortcuts to unfinished work. Inquiries list: search, status/division filters, who is handling what.

**Part 2: an agent's form becomes a proposal (8 min).**
1. Email `Franchise-Form-Rizal-Coastal-Foods.xlsx` to the test inbox. On **Requests**, click **Check mail now**: the
   form is imported automatically as a new inquiry ("Imported automatically"). Every staff member gets a notification.
2. Open **Northstar Logistics**. Open the submitted form (looks like the original Excel). Click **Start handling**.
   Point out: colleagues can view but not edit while you handle it.
3. **Choose template**: suggestions based on sector, plan and payment mode. Open **Need help with proposal?**. Preview, then select.
4. **Preview & approval**: the proposal is filled from the form. Click **Check proposal details**: it flags phone
   formats, titles (Engr.), and anything changed from the original form.
5. **Prepare PDF & email**, then **Send to supervisor for approval**.

**Part 3: the supervisor (5 min).** In the second window, sign in as Emerson.
1. **Approval Queue** → Northstar (or Bayani, already waiting). The frozen PDF and the email exactly as they will go out.
2. Show **Return for correction** on Cedar (already returned: the note and flag are visible to staff).
3. **Approve** Northstar. Switch to the Gmail tab: the email with the exact PDF arrives (redirected to the test inbox).
   Back in the app the status is **Sent** and the **30-day client protection** countdown has started.

**Part 4: protecting the agent's client (4 min).**
1. Open the **Northstar duplicate** (Victor Tan): processing is held because the same company was registered by another
   agent; it links to the original. A supervisor can confirm "different clients", decline, or transfer with a BOR.
2. Open **Harbor Point**: protection days left, and the recorded progress report that renewed it.
3. **Archives**: Silverline (declined, with its reason). Nothing is deleted.

**Part 5: other cases (3 min).**
- **Sunrise**: the form had no employee ages, so the system blocked the PDF and staff sent a details request (that email is in the inbox).
- Email `Scanned-Inquiry-Mountain-View-Academy.pdf`: it waits on **Requests** (a PDF could be anything); click **Create inquiry**.
- **Customize** (optional): on Lakeside, choose Customize, edit a paragraph. It is labeled Customized and the supervisor sees a before/after list.

**Part 6: admin (2 min).** Sign in as Admin: Users & roles, Proposal templates (upload/preview/publish), Monitoring,
and the email status badge (TEST EMAIL).

## What to say honestly

- This is the **test version** with made-up data. Real email to agents, the company mailbox, and real staff logins come at go-live.
- "Need help with proposal?" is **rule-based**, using your template catalog. It doesn't use an AI model and doesn't make underwriting decisions.
- PDFs are made from your Word templates on a server; small font differences from Word are still being checked
  (sample PDFs are ready for your sign-off).
- The inbox is checked every 2 minutes while someone has the app open; use **Check mail now** to see it immediately.

## Known limits on demo day

- **Phones**: everything works. On a phone the supervisor's bar is one row: **Approve & email agent** plus **More**
  (Return for correction, Edit before approval). A sent proposal shows a short file card with **Open PDF** and **Word**
  instead of drawing every page; laptops still show the full PDF.
- Email caps for the demo: 30 per hour, 100 per day, all redirected to the test inbox. If a send is refused for the cap,
  the approval is kept and **Retry** works later.
- Files over 4.5 MB can't be uploaded or downloaded online yet.
- Many testers at once has not been load-tested. If someone sees "Another colleague updated this inquiry", reload: that is the safety check working.
- If someone else is handling an inquiry, you can view it but not edit it (by design). A closed tab releases it after 90 seconds.

## If something goes wrong

- **Page slow or error on the first load**: the free database was asleep; reload after 20 s.
- **Email doesn't arrive**: check the Gmail Spam folder; the app shows the delivery state in the inquiry history.
- **PDF preparation takes 10–30 s**: normal; the converter starts on demand.
- **Wi-Fi fails**: use your phone's hotspot. There is no offline copy of the online data.

## After the demo

- Revoke the Shareable Link (Vercel → the deployment → Share → revoke).
- Remove the demo caps if you like: `vercel env rm RMC2_MAIL_CAP_PER_HOUR preview` and `vercel env rm RMC2_MAIL_CAP_PER_DAY preview`, then redeploy.
- Optionally rotate the demo passwords again:
  `node --env-file=.env.supabase.test scripts/rotate-demo-passwords.mjs --project-ref pgoiqwixaeqbxlwbmren`.
