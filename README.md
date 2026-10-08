# RMC2 Franchising prototype

The dashboard shows three counts (To prepare, In review, Ready to send) and a shared inquiry list. New inquiries notify all active staff with independent read status.

## Inquiry flow
1. Review the submitted form. Core fields are visible; other details, assignment and source preview can be opened as needed. There is no separate AI extraction step.
2. Prepare a proposal from an approved source. The proposal library starts empty because real proposals have not been supplied. The demo compares the form’s client sector with user-supplied references and copies selected reference text exactly. It does not infer eligibility, invent prices or benefits, or retrieve outside information.
3. Submit for supervisor review, handle changes, preview the approved PDF and simulate Gmail send. The selected source is retained as a snapshot. Supervisor notes and activity remain available.

Admin can add actual approved reference text in Proposal library. No sample proposal references are preloaded. Do not use private customer information in this demonstration. The form sample follows the supplied workbook with fictional account and contact details.

## Boundaries
This is a browser-local prototype. No live AI, Gmail, authentication or database integration is active. The simplified demo uses a new local storage namespace (`rmc2-franchising-simple-v3`) so previous sample drafts and fictional plan selections are not used. Earlier demo state is retained under its old namespace.

## Run
Next.js, TypeScript, React and Tailwind with existing shadcn primitives.
Start: npm run dev. Build: npm run build. Static output: out.

## Validation
Checked the empty-library behavior, absence of an extraction step and invented recommendations, exact preservation of approved source text, shared preparation, supervisor approval, simulated send, mobile layout and runtime errors.
