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

## PLANNED (do not build yet)

- GET per-admin drill-down: funnel, revenue, lost reasons, time to convert for one admin.
- GET notes feed across all admins, filterable by admin and date range, paginated.
- Pipeline stages, SLA flags, activities, attribution, commission, weekly scorecard, dormant buyers, CSV import and export.

Each will be added here with exact request and response shapes when its backend PR is ready.
