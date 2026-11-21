# Leads: frontend contract for the admin dashboard

Audience: the admin frontend session. Source of truth is the backend code in `src/leads`. All routes need a signed-in admin (JWT) and the permission shown. The server enforces access; the UI should only hide what a user cannot use.

Status key: LIVE means it exists today. PLANNED means it is not built yet, so do not build against it until the backend session confirms the shape.

## Permissions

| Permission | Used for |
| --- | --- |
| read_leads | List and view leads, read notes, own performance |
| update_leads | Change status, add and delete notes |
| assign_leads | Claim and release leads |
| view_reports_leads | Performance of every owner |
| send_leads | Notify a lead, bulk SMS |
| import_leads | Upload lead files |
| delete_leads | Soft delete a lead |

Ownership rule: once a lead has an owner, only that owner or a super admin can change its status, message it, or add notes. A note can only be deleted by its author or a super admin.

## LIVE endpoints

### GET /leads (read_leads)
Query: page, limit, search, status, source, sourceLeadId, campaignName, campaignId, ownerId (a user id, or `me`).
Returns a paginated result. Each row has the lead fields plus insights and `owner` (`{ id, name }` or null).

### GET /leads/:id (read_leads)
One lead with details.

### PATCH /leads/:id/status (update_leads)
Body is UpdateLeadStatusDto. Returns the updated lead. Fails if another admin owns the lead and the caller is not a super admin.

### POST /leads/:id/claim and DELETE /leads/:id/claim (assign_leads)
Take or release ownership of one lead. UUID path param.

### POST /leads/claim (assign_leads)
Body: `{ "leadIds": [uuid, ...] }`, 1 to 100 unique ids.

### GET /leads/:id/notes (read_leads)
Newest first. Each note: `{ id, leadId, body, createdAt, author }`. `author` is `{ id, name }` or null.

### POST /leads/:id/notes (update_leads)
Body: `{ "body": string }`, 1 to 5000 characters.

### DELETE /leads/:id/notes/:noteId (update_leads)
Author or super admin only.

### GET /leads/performance (view_reports_leads)
Query: `from`, `to` (ISO 8601 dates, filter on assignment date).
Returns an array, best paying first. Each item is `{ owner: { id, name }, ...performance }`.

### GET /leads/performance/me (read_leads)
Same query. Returns `{ ownerId, ...performance }` for the signed-in admin.

Performance fields: assigned, contacted, qualified, rejected, registered, registeredBeforeClaim, paying, revenue (NGN, not kobo), contactRate, registrationRate, plus the rate and time-to-convert fields defined by `LeadPerformance` in `src/leads/lead-ownership.service.ts`. Read that interface for the full list.

## Super admin oversight: what the UI can do today

1. Super admin leaderboard page from GET /leads/performance, with a date range.
2. Click an admin to open GET /leads?ownerId=<id> for their leads, and GET /leads/:id/notes for each lead's notes.
3. Gate the page on the `view_reports_leads` permission. This is intentional: oversight is open to any role granted that permission, and super admins hold it by default. Do not label the page "Super admin only" or check for the super admin role in the UI.

## Added in the lead API PR (branch `feat/leads-api`, live once merged)

New permissions on the `leads` resource: `create_leads` (granted by migration to roles that can already update leads) and `reassign_leads` (not granted to anyone by migration; super admins always have it, others must be given it).

### GET /leads/notes (view_reports_leads)
Notes across every lead, newest first. Query, all optional: `adminId` (uuid, author), `from`, `to` (ISO 8601, on note date, `to` exclusive), `page` (default 1), `limit` (default 20, max 100).
```json
{
  "data": [
    {
      "id": "uuid",
      "leadId": "uuid",
      "leadName": "Green Valley Farms",
      "body": "text",
      "createdAt": "2026-11-21T09:00:00.000Z",
      "author": { "id": "uuid", "name": "Ada Obi" }
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 20
}
```
`leadName` is `"Anonymised lead"` for a lead whose personal data was removed. `author` is null if the admin no longer exists.

### GET /leads/performance/:adminId (view_reports_leads)
Query: `from`, `to` as for `/leads/performance`. The path value must be a uuid. Returns 404 for an unknown admin, zeros for an admin with no leads.
```json
{
  "owner": { "id": "uuid", "name": "Ada Obi" },
  "assigned": 5, "contacted": 3, "qualified": 1, "rejected": 0,
  "registered": 1, "registeredBeforeClaim": 0, "paying": 1, "revenue": 150000,
  "contactRate": 60, "registrationRate": 20, "payingRate": 20,
  "registeredToPayingRate": 100, "avgDaysToRegister": 2.5, "avgDaysToFirstPayment": 4,
  "stages": { "new": 1, "contacted": 0, "visited": 0, "quoted": 1, "ordered_paid": 0, "lost": 3 },
  "lostReasons": [ { "reason": "price", "count": 2 }, { "reason": "competitor", "count": 1 } ],
  "overdueFollowUps": 1
}
```
`revenue` is NGN, not kobo. `lostReasons` is sorted by count and only lists reasons that occur. Until the stage rules ship, only leads backfilled from "rejected" carry a reason (`other`), so expect this list to be short at first. `overdueFollowUps` counts leads with a past-due next action that are not ordered_paid or lost.

### POST /leads (create_leads)
Create a lead by hand (customer support, social team, or a rep in the field). Body (unknown fields are rejected):
`name`, `phone`, `source` are required. `source` is one of meta, manual, website, other, field_visit, referral, cs_social, whatsapp, phone_call, ayo_web_chat, event_market, partner.
Optional: `contactPerson`, `email`, `townOrLga`, `state` (free text, any state), `stateId` (uuid from the state table), `buyerType` (smallholder, commercial_farm, cooperative, agro_dealer, institution), `productInterest` (day_old_chicks, feed, medication_vaccines, other_inputs, mixed), `farmSize` (number) with `farmSizeUnit` (birds, fish, hectares), `estimatedOrderValueKobo` (integer), `sourceDetail` (for example tiktok), `partnerName`, `note`, `ownerId` (hand the lead to that admin, which sets `handedOverAt`), `assignToMe` (boolean).
Returns `{ "duplicate": boolean, "lead": {...} }`. The phone is stored as +234XXXXXXXXXX. If the number already exists (any format), nothing is created: a note is logged on the existing lead, its owner is kept, and `duplicate` is true with the existing lead.

### PATCH /leads/:id (update_leads)
Edit profile fields: `name` plus the optional profile fields above. The phone cannot be changed. An empty body is a 400. Owned leads follow the usual ownership rule (owner or super admin).

### GET /leads/:id/activities (read_leads)
Query: `page`, `limit` (max 100). Newest first.
```json
{
  "data": [
    {
      "id": "uuid", "leadId": "uuid",
      "type": "call",
      "summary": "text or null",
      "latitude": 8.4966, "longitude": 4.5421,
      "photoKey": "S3 key or null",
      "quoteAmountKobo": 150000000,
      "nextAction": "Send quote", "nextActionAt": "2026-11-23T09:00:00.000Z",
      "occurredAt": "2026-11-21T09:00:00.000Z",
      "createdAt": "2026-11-21T09:00:05.000Z",
      "author": { "id": "uuid", "name": "Ada Obi" }
    }
  ],
  "total": 1, "page": 1, "limit": 20
}
```

### POST /leads/:id/activities (update_leads)
Body: `type` (call, whatsapp, visit, quote, note) is required. Optional: `summary`, `occurredAt` (not in the future), `latitude` and `longitude` (send both or neither, visits only), `photoKey` (visits only), `quoteAmountKobo` (quotes only), `nextAction` (needs `nextActionAt`), `nextActionAt`, `idempotencyKey` (max 100 characters).
Returns `{ "activity": {...}, "duplicate": boolean }` with status 201. Send the same `idempotencyKey` on a retry and you get the original activity back with `duplicate: true`, so offline drafts cannot log twice.
Effects on the lead: `lastActivityAt` is updated. A call, WhatsApp or visit sets `contactedAt` the first time. A call, WhatsApp, visit or quote replaces the lead's next action with the one sent, or clears it if none is sent. A note changes the next action only if it carries one. Another rep's owned lead returns 403.

### POST /leads/:id/reassign (reassign_leads)
Body: `{ "toOwnerId": uuid, "reason"?: string }`. Moves the lead without the owner releasing it and logs who, from, to and why. 400 if the new owner is not an active admin or already owns the lead, 404 for an unknown lead. Returns the updated lead.

### GET /leads/:id/owner-history (read_leads)
Newest first: `[{ id, from, to, actor, reason, createdAt }]` where `from`, `to` and `actor` are `{ id, name }` or null. Claims, releases, hand-over at creation and reassignments are all recorded. Hand-over at creation has the reason "Handed over at creation".

### New filters on GET /leads
`stage` (new, contacted, visited, quoted, ordered_paid, lost), `buyerType`, `stateId`, `overdue=true` (past-due next action, not ordered_paid or lost), `slaBreached=true`. `search` now also matches contact person and town or LGA. Lead rows now also carry the new profile, stage and follow-up fields.

## PLANNED (do not build yet)

- Stage changes with rules and history, lost reasons set by users, the 24 hour SLA clock and notifications, attribution, commission, weekly scorecard, dormant buyers, CSV import and export.

Each will be added here with exact request and response shapes when its backend PR is ready.
