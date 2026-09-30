import { EntityManager } from 'typeorm';

export const EXCLUDED_NOTIFICATION_EMAILS = [
  'ak.fatoki@gmail.com',
  'akwilly17@gmail.com',
  'iadekola88@gmail.com',
  'onidamilola39@gmail.com',
];
export const EXCLUDED_NOTIFICATION_PHONE = '2348023140456';

export function normalizedContactPhone(phone?: string): string {
  const digits = (phone ?? '').replace(/\D/g, '').replace(/^00/, '');
  return digits.startsWith('0') && digits.length === 11
    ? `234${digits.slice(1)}`
    : digits.length === 10
    ? `234${digits}`
    : digits;
}

export async function isNotificationExcluded(
  manager: EntityManager,
  contact: { userId?: string; email?: string; phoneNumber?: string },
): Promise<boolean> {
  const email = contact.email?.trim().toLowerCase() || '';
  const phone = normalizedContactPhone(contact.phoneNumber);
  if (
    EXCLUDED_NOTIFICATION_EMAILS.includes(email) ||
    phone === EXCLUDED_NOTIFICATION_PHONE
  )
    return true;
  if (!contact.userId && !email && !phone) return false;
  // Resolve the account as well: an excluded email also suppresses its phone,
  // and an excluded phone also suppresses its email and in-app notifications.
  const rows = await manager.query(
    `SELECT 1 FROM "user" u WHERE
    (u.id::text = $1 OR lower(trim(u.email)) = NULLIF($2, '')
      OR regexp_replace(u.phone, '[^0-9]', '', 'g') = ANY($3::text[]))
    AND (lower(trim(u.email)) = ANY($4::text[])
      OR regexp_replace(u.phone, '[^0-9]', '', 'g') = ANY($5::text[])) LIMIT 1`,
    [
      contact.userId || '',
      email,
      phone
        ? [
            phone,
            `+${phone}`,
            phone.startsWith('234') ? `0${phone.slice(3)}` : phone,
            phone.startsWith('234') ? phone.slice(3) : phone,
          ]
        : [],
      EXCLUDED_NOTIFICATION_EMAILS,
      ['2348023140456', '08023140456', '8023140456', '002348023140456'],
    ],
  );
  return rows.length > 0;
}

export class NotificationExcludedError extends Error {
  constructor() {
    super('Recipient is excluded from all notifications');
  }
}
