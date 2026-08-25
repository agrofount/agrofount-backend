import { SESClient } from '@aws-sdk/client-ses';
import { EmailTemplateIds } from '../src/notification/types/notification.type';
import { createOrUpdateSesTemplate } from '../src/config/sendInBlue.config';

type BrevoTemplateResponse = {
  subject?: string;
  htmlContent?: string;
  textContent?: string;
  plainContent?: string;
};

const brevoApiKey = process.env.SEND_IN_BLUE_API_KEY;
const awsRegion = process.env.AWS_SES_REGION || process.env.AWS_REGION;
const sesTemplatePrefix = process.env.AWS_SES_TEMPLATE_PREFIX || 'agrofount_';

function getTemplateIds(): number[] {
  if (process.env.BREVO_TEMPLATE_IDS) {
    return process.env.BREVO_TEMPLATE_IDS.split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value > 0);
  }

  return Object.values(EmailTemplateIds)
    .filter((value): value is number => typeof value === 'number')
    .sort((a, b) => a - b);
}

function convertBrevoVariables(template = ''): string {
  return template.replace(
    /\{\{\s*params\.([a-zA-Z0-9_]+)(?:\s*\|\s*[a-zA-Z0-9_]+)?\s*\}\}/g,
    '{{ $1 }}',
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const message = (error as Error).message || String(error);
      const retryable = /rate exceeded|throttl|too many requests/i.test(
        message,
      );
      if (!retryable || attempt === 3) break;
      await sleep((attempt + 1) * 1_500);
    }
  }

  throw lastError;
}

async function fetchBrevoTemplate(
  templateId: number,
): Promise<BrevoTemplateResponse> {
  const response = await fetch(
    `https://api.brevo.com/v3/smtp/templates/${templateId}`,
    {
      headers: {
        accept: 'application/json',
        'api-key': brevoApiKey,
      },
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (!response.ok) {
    throw new Error(`Brevo returned HTTP ${response.status}`);
  }

  return response.json();
}

async function main() {
  if (!brevoApiKey) {
    throw new Error('SEND_IN_BLUE_API_KEY is required');
  }
  if (!awsRegion) {
    throw new Error('AWS_SES_REGION or AWS_REGION is required');
  }

  const ses = new SESClient({ region: awsRegion });
  const templateIds = getTemplateIds();
  const failures: string[] = [];

  for (const templateId of templateIds) {
    const templateName = `${sesTemplatePrefix}${templateId}`;

    try {
      const brevoTemplate = await fetchBrevoTemplate(templateId);
      const result = await withRetry(() =>
        createOrUpdateSesTemplate(ses, {
          templateName,
          subject: convertBrevoVariables(brevoTemplate.subject || ''),
          htmlContent: convertBrevoVariables(brevoTemplate.htmlContent || ''),
          textContent: convertBrevoVariables(
            brevoTemplate.textContent || brevoTemplate.plainContent || '',
          ),
        }),
      );

      console.log(`${result}: Brevo ${templateId} -> SES ${templateName}`);
    } catch (error) {
      const message = `${templateId}: ${(error as Error).message}`;
      failures.push(message);
      console.error(`failed: ${message}`);
    }
  }

  if (failures.length) {
    throw new Error(`Template migration failed for ${failures.join(', ')}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
