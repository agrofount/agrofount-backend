# Prompt: Extend the Leads module into lead-to-paid-order tracking, attribution, commission and weekly scorecards

## Context

You are working in the agrofount-backend repo (NestJS, TypeORM, PostgreSQL, Redis, BullMQ, `@nestjs/schedule`). Agrofount is an agri-input marketplace in Nigeria selling day-old chicks, feed, medication and vaccines, seeds and fertiliser. A leads module already exists in `src/leads` with lead capture, status, notes, ownership (claim, release, assign), per-owner conversion performance and `leads` permissions. Extend it. Do not create a second leads module, and do not duplicate the existing buyer (user), order, product category or admin entities.

This repo is backend only. For anything that needs UI (pipeline board, field view, scorecard pages), deliver the API contract in `docs/leads-frontend-contract.md` and notify the admin frontend session, not frontend code.

## Goal

Take every lead from first contact to a confirmed, fully paid order, attribute that order to the staff member who generated it, and produce the weekly numbers that sales and customer support are scored on.

## Step 0: Explore, then stop for approval

Write no code yet. Read the repo and report briefly on:

1. What the leads module already does: entity fields, status values, notes, ownership rules, the conversion performance and leaderboard logic, and the existing customer stage (lead, registered, paying). Say which parts of this spec are already met and which are gaps.
2. How orders, payments (Paystack webhook, wallet, credit facility), dispatch, users and roles/permissions work, and where "fully paid" is currently determined.
3. How Ayo and WhatsApp create users or orders, and whether a notification service exists (`src/notification`).
4. Conventions: migrations (`src/config/database/migrations`), REST versus GraphQL (confirm whether GraphQL is actually used here), DTO validation, jest unit and e2e layout, BullMQ and cron jobs, audit log (`src/audit-log`).
5. A gap analysis and a PR-by-PR plan: files to add or change, migrations, and what you will reuse.
6. A list of ambiguities and any places where this spec conflicts with existing behaviour. Ask rather than assume.

Wait for my approval before implementing.

## Business rules

**Lead fields.** Name, contact person, phone normalised to +234, optional email, town or LGA, state, buyer type (Smallholder, Commercial farm, Cooperative, Agro-dealer, Institution), farm size (birds, fish or hectares), product interest (Day-old chicks, Feed, Medication and vaccines, Other inputs, Mixed), estimated order value, owner, notes. Add only the fields that are missing.

**States.** A reference table, seeded with the 12 focus states (Lagos, Ogun, Oyo, Osun, Ondo, Kwara, FCT Abuja, Kaduna, Kano, Plateau, Rivers, Enugu). Other states must still be accepted. Reuse `src/state` if it fits.

**Sources.** Field visit, Referral, CS or social lead (Facebook, Instagram, TikTok, X, LinkedIn), WhatsApp, Phone call, Ayo web chat, Website sign-up, Event or market, Partner (for example MOFARMS.NG). Map existing source values rather than replacing them.

**Stages.** New, Contacted, Visited, Quoted, Ordered and paid, with Lost as an exit from any stage.
- Lost needs a reason: price, no stock, timing, competitor, unreachable, other.
- Every stage change goes to an append-only activity log (who, when, from, to, note).
- "Ordered and paid" is set only by the system, when a linked order is fully paid and not cancelled or refunded. It can never be set manually or by the client.
- Define how the new pipeline stage relates to the existing status and customer stage, and migrate existing data without losing history.

**Activities.** Call, WhatsApp, in-person visit (optional GPS, optional photo to S3), quote, note. Each can set a next action and date. A lead with a past-due next action that is not won or lost is flagged overdue.

**Handover SLA.** When CS or social staff create a lead and assign it to a rep, record handover time and the rep's first contact time. Flag leads not contacted within 24 hours. Notify the owner and the team lead when the deadline is close (propose a threshold, for example 4 hours left) and again on breach.

**De-duplication.** Match on normalised phone number. On a match, add an activity to the existing lead and keep the original owner. Only admins can reassign, and every reassignment is logged.

**Conversion.**
- Orders placed through the dashboard, admin entry, Ayo or WhatsApp are linked to the lead, and the buyer account is created or linked.
- A lead's first fully paid order makes it a new paying buyer. Later paid orders are repeat orders.
- Orders cannot be dispatched until fully paid, except for buyers flagged as credit-pilot. Count and report every dispatch before full payment.
- Payment confirmation comes only from the verified Paystack webhook or an admin confirmation, never from the client. Make the handler idempotent so a replayed webhook cannot double count.

**Attribution.** Each order stores the attributed staff member and source (lead owner, referral code, logged lead), set at order time. Only an admin can change it, with an audit entry. Staff can have a personal referral code that buyers or Ayo can apply. Backfill historical orders as "unattributed".

**Commission (calculate and report only, no payouts).** Calculated on goods value only, excluding delivery and tax, on orders fully paid and not cancelled or refunded.
- Sales reps: 0.6% to 1.2% by product category, from an admin-editable rate table. Paid quarterly, only if the rep met the quarterly target. Quarters run from each rep's start date (for example a rep starting 16 Nov 2026 has a first quarter of 16 Nov 2026 to 15 Feb 2027). Targets are set per rep per quarter by an admin.
- CS and social staff: 1% per paid order, monthly.
- A refund or reversal after payout creates a negative adjustment in the next period.
- Produce a statement per person per period: orders included, rate, amount, target met or not.
- For orders with several categories, apply each line's category rate to that line's goods value.

**Dormant buyers.** No paid order in 30 or more days. Provide a queue showing last order, products bought and owner. Track reactivation contacts, and count a reactivation as a new paid order after a contact.

**Weekly metrics.** Weeks end Friday, Africa/Lagos time. Per staff member and for the team:
- day-old chicks sold (birds on confirmed, paid orders), paid sales value in naira, non-chick input orders
- new paying buyers, repeat orders
- in-person visits, new qualified leads (define "qualified" with me), follow-up calls and WhatsApp messages
- percent of CS or social leads contacted within 24 hours, percent of leads with activity logged
- orders dispatched before full payment
- lead-to-order conversion by source and by stage, average days from lead to first paid order, lost-reason breakdown
- dormant buyers contacted and reactivated

Weekly targets are stored per staff member per period, and each metric reports actual, target and Met or Below, matching the existing Rocks and Scorecard spreadsheets.

## Roles and access (enforce on the server)

- Sales rep: own leads, own scorecard and commission.
- Sales lead: all sales leads and scorecards, can assign and reassign.
- CS or social: create leads and hand over, see own handovers and commission.
- Admin or CEO: everything, including targets and commission rates.
- Super admin: can view and track the lead conversion performance of every other admin, including each admin's leads, stage changes and full notes history (author, timestamp). This is read access. Existing rules stay in force: only a lead's owner or a super admin can change its status, message it or add notes.
- Oversight access is deliberately not super-admin-only. It is open to any role granted `view_reports_leads`, and a super admin holds it by default. Do not add a super-admin-only check to `GET /leads/performance` or the new drill-down and notes feed.

Build on the existing permission system and the `leads` permissions already added (`read_leads`, `update_leads`, `assign_leads`, `view_reports_leads`), rather than hard-coding roles.

## Data protection (NDPA)

- Exports restricted to sales lead and admin, and every export logged.
- Support deleting or anonymising a lead on request, while keeping aggregate metrics intact.
- GPS stored only when the rep chooses to attach it.
- Send Gemini only what the current conversation needs. Never send stored lead PII beyond that.
- Log super admin views of other admins' notes where they contain personal data.
- Do not put secrets, tokens or real personal data in seeds, logs, tests or docs.

## Engineering requirements

- Reversible migrations that do not break existing orders or leads. Test `up` and `down`.
- Money as integer kobo. Times stored in UTC, week and quarter boundaries computed in Africa/Lagos. Note the existing performance revenue is in NGN, so decide and document the conversion.
- Indexes for owner plus stage, next action date, phone and created date.
- Scorecard aggregation as a scheduled BullMQ job writing to a summary table (Redis as cache only), and also computable on demand for any past week.
- Notifications (SLA warnings, overdue next actions, weekly scorecard summary to the CEO on Fridays at 5 pm Lagos time) go through the existing notification module. If it lacks what is needed, extend it behind an interface that WhatsApp can plug into later.
- Super admin oversight: extend `GET /leads/performance` with a per-admin drill-down (funnel, revenue, lost reasons, time to convert) and add a paginated notes feed across all admins filtered by admin and date range. Gate both with `view_reports_leads`, the same as the existing leaderboard. Admins without it get only their own data through `GET /leads/performance/me`.
- Ayo: create or update a lead (source Ayo web chat) when an unregistered person shows buying intent and log a conversation summary. Link and attribute orders Ayo places. Add a tool that tells a buyer which rep is assigned to them.
- CSV export of leads and the weekly scorecard. CSV import from the Excel pipeline tracker with a dry-run preview and de-duplication.
- Provide API contracts for the pipeline board, lead list filters (owner, stage, source, state, buyer type, overdue, SLA breached, search), lead detail with timeline and linked orders, dormant queue, scorecard and commission statements. For the mobile field view, make the API tolerant of retried requests (idempotency keys) so offline drafts cannot create duplicate leads or visits.

## Tests

- Unit: stage rules, de-duplication, attribution, commission (target not met, refund after payout, multi-category orders), 24-hour SLA, week and quarter boundaries.
- E2E: Paystack webhook, then "Ordered and paid", then scorecard, including webhook replay and refund.
- Seed data for staging with sample leads across all stages.

## Delivery

Ship as small PRs in this order, each ending with lint, type check and tests passing, plus docs on how to use the feature:

1. Schema and migrations
2. Lead and activity API
3. Stage and conversion logic with the payment hook
4. Attribution and commission
5. Scorecard jobs and APIs
6. Notifications and SLA jobs
7. Ayo integration
8. CSV import and export
9. Frontend specs for the dashboard and field view

After each API PR, update `docs/leads-frontend-contract.md` with request and response shapes and the permission needed, then message the admin frontend session (`agrofount-admin-frontend-82`) so it can build its part. Do not leave the frontend to guess.

Stop after Step 0 and after PR 1 for my review.

## Done means (on staging)

I can create a lead, hand it from CS to a rep and see the 24-hour clock, log visits and calls, create an order for the lead and pay it through the Paystack test webhook, and watch the lead move to "Ordered and paid" automatically, counted as a new paying buyer and attributed to the rep. That week's scorecard and the rep's commission statement update correctly, and importing our Excel tracker creates no duplicates. A super admin can see every admin's conversion performance and notes.
