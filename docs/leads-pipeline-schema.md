# Leads pipeline schema (PR 1)

Schema only. No behaviour changes: nothing reads or writes the new columns yet.

## Lead columns added

- `stage` (new, contacted, visited, quoted, ordered_paid, lost), `lostReason`. The existing `status` is unchanged so campaigns, SMS and the leaderboard keep working.
- Buyer profile: `contactPerson`, `townOrLga`, `stateId` (no foreign key, like `ownerId`; free-text `state` stays for other states), `buyerType`, `productInterest`, `farmSize` and `farmSizeUnit`, `estimatedOrderValueKobo`, `sourceDetail`, `partnerName`.
- Handover SLA: `createdById`, `handedOverAt`, `slaWarnedAt`, `slaBreachedAt`. First contact time is the existing `contactedAt`.
- Follow-up: `nextAction`, `nextActionAt`, `lastActivityAt`. `anonymisedAt` marks a lead whose personal data was removed.
- New `source` values: field_visit, referral, cs_social, whatsapp, phone_call, ayo_web_chat, event_market, partner. Website sign-up is the existing `website`.

## Backfill

`stage` is mapped from `status`: new stays new, rejected becomes lost with reason other, everything else becomes contacted. `ordered_paid` is never backfilled here. Only the payment hook (PR 3) sets it, and it will backfill from payments.

## New tables

- `lead_stage_history`: append-only. A trigger rejects UPDATE and DELETE.
- `lead_owner_history`: every ownership change, including reassignment.
- `lead_activities`: call, whatsapp, visit, quote, note. Optional GPS and S3 `photoKey`, `quoteAmountKobo`, next action, and a per-author `idempotencyKey` so retried field requests do not duplicate.
- `commission_rates`: rate in basis points per `categoryKey` (matches `product.primaryCategory`). Empty on purpose: rates are a business decision.
- `staff_targets`: one row per admin, period, and metric. Covers weekly metrics and the quarterly sales target.

## Other changes

- `orders`: `leadId`, `attributedAdminId`, `attributionSource` (existing rows default to unattributed), `attributedAt`.
- `Admin`: `startDate` (quarters run from it) and a unique `referralCode`.
- Indexes: owner and stage, next action date (partial), normalised phone, order lead and attributed admin.

## Reversibility

Both migrations have a working `down`. Rolling back the source enum values rebuilds the type and sets leads using a new source to `other`. Timestamps on new columns are `timestamptz`.

## Not in this PR

Credit-pilot flag, dispatch payment gate, commission ledger and scorecard summary tables. They arrive in PRs 3 to 5.
