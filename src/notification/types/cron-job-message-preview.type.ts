export type CronJobMessagePreview = {
  channel: 'EMAIL' | 'SMS' | 'IN_APP';
  subject?: string;
  html?: string;
  text?: string;
  templateId?: number;
  params?: Record<string, unknown>;
  renderError?: string;
  sampleTarget: { name: string; email?: string | null; phone?: string | null };
  usedFallbackSample: boolean;
};
