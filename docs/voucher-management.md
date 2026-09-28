# Admin voucher management

All routes require an authenticated administrator. Roles need `create_vouchers`,
`read_vouchers`, or `update_vouchers` as appropriate; super admins have access.

Vouchers are single-use, assigned to one existing customer, and denominated in
NGN. The amount is a positive whole-naira discount. No schema migration is needed.
Creating a voucher does not send an SMS or email automatically.

## Create

`POST /voucher/admin`

```json
{
  "userId": "00000000-0000-4000-8000-000000000001",
  "code": "WELCOME-BACK-2026",
  "amount": 2000,
  "minimumSpend": 15000,
  "campaign": "September reactivation",
  "expiresAt": "2026-10-31T23:59:59+01:00"
}
```

Replace userId with the actual customer's UUID. Omit code to generate one.
Custom codes are trimmed and uppercased and must contain 3–40 letters, digits,
underscores, or hyphens. Expiry must be a future ISO timestamp with a timezone.

## List and inspect

- `GET /voucher/admin/all?page=1&limit=25`
- `GET /voucher/admin/all?filter.status=$eq:disabled`
- `GET /voucher/admin/all?filter.user.id=$eq:CUSTOMER_UUID`
- `GET /voucher/admin/all?search=WELCOME`
- `GET /voucher/admin/WELCOME-BACK-2026`

Admin detail lookup includes redeemed, disabled, and expired vouchers. The
customer lookup continues to reject vouchers that cannot be redeemed. Expiry
is enforced using expiresAt even if the stored status is still active; use
filter.expiresAt with `$lt:ISO_TIMESTAMP` to find vouchers past their expiry.

## Edit or disable

`PATCH /voucher/admin/WELCOME-BACK-2026`

```json
{
  "amount": 2500,
  "minimumSpend": 20000,
  "expiresAt": "2026-11-30T23:59:59+01:00"
}
```

Disable with `{"status":"disabled"}`. Reactivate with `{"status":"active"}`;
include a future expiresAt if the voucher has expired. Code and customer cannot
be reassigned. Used/redeemed vouchers cannot be edited or reactivated.
Vouchers are disabled rather than deleted to preserve redemption history.

Existing checkout rules still enforce ownership, expiry, status, minimum spend,
and single redemption. No public/shared coupon or percentage discount is added.

## Bulk generation by segment

Create one voucher per customer in a cohort instead of one at a time. Segments:
`never_ordered`, `one_time_buyer`, `lapsed_regular`, `high_value_churned`.

Every segment excludes customers with an unresolved complaint (open or
in-progress) and customers who already hold an active, unexpired voucher -
a customer can only use one voucher per order, so there's no reason to hand
them a second one before the first is used or expired.

### Preview matches

`POST /voucher/admin/bulk/preview` (requires `read_vouchers`)

```json
{
  "segment": "lapsed_regular",
  "inactivityDays": 90,
  "minOrders": 3
}
```

Returns `{ segment, matched, customers }` - `matched` is the true count of
qualifying customers (up to an internal safety ceiling of 1000), `customers`
is a display sample of up to 50 rows with order count, lifetime spend, and
last order date. Use this to see exactly who a run will affect before
generating anything - no vouchers are created by this call.

### Generate

`POST /voucher/admin/bulk` (requires `create_vouchers`)

```json
{
  "segment": "lapsed_regular",
  "inactivityDays": 90,
  "minOrders": 3,
  "amount": 1500,
  "campaign": "Winback-Sept-2026",
  "expiresAt": "2026-10-31T23:59:59+01:00"
}
```

Creates exactly one voucher per customer who matches the same criteria used
in the preview call - the count generated always equals the count matched,
there is no separate "how many" input. `campaign` doubles as the idempotency
key: re-running the same segment with the same campaign label will not create
duplicate vouchers for a customer who already received one under that label.

Segment-specific filters: `inactivityDays` (all segments except
`never_ordered`), `minOrders` (`lapsed_regular` only, default 3),
`minLifetimeSpend` (`high_value_churned` only, default 100000).
