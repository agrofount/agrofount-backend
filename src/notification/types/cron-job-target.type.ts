export type CronJobTarget = {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  reason: string;
};
