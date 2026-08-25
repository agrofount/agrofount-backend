import { ConfigService } from '@nestjs/config';
import {
  CreateTemplateCommand,
  GetTemplateCommand,
  SendEmailCommand,
  SendTemplatedEmailCommand,
  SESClient,
  UpdateTemplateCommand,
} from '@aws-sdk/client-ses';

type EmailTemplate = { subject?: string; htmlContent?: string };
type EmailProviderName = 'brevo' | 'ses';
type EmailProviderOptions = { provider?: EmailProviderName };
type EmailProvider = {
  sendEmail: (
    to: string,
    templateId: number,
    params?: Record<string, any>,
    options?: EmailProviderOptions,
  ) => Promise<void>;
  getTemplate: (templateId: number) => Promise<EmailTemplate>;
  sendCustomEmail: (
    to: string,
    subject: string,
    htmlContent: string,
    textContent: string,
    replyTo?: string,
    options?: EmailProviderOptions,
  ) => Promise<void>;
};

// Brevo returns a JSON error body (typically `{ code, message }`) alongside
// a non-ok HTTP status. Best-effort parse it so callers get real provider
// detail instead of just an HTTP status number - tolerate a non-JSON body.
async function describeErrorResponse(response: Response): Promise<string> {
  try {
    const body = await response.json();
    const detail = body?.message || body?.code;
    return detail
      ? `Brevo returned HTTP ${response.status}: ${detail}`
      : `Brevo returned HTTP ${response.status}`;
  } catch {
    return `Brevo returned HTTP ${response.status}`;
  }
}

export function buildSesTemplateName(
  templateId: number,
  configService: ConfigService,
): string {
  const prefix =
    configService.get<string>('AWS_SES_TEMPLATE_PREFIX') || 'agrofount_';
  return `${prefix}${templateId}`;
}

function describeSesError(error: unknown): string {
  const err = error as Error & { name?: string; Code?: string };
  const code = err.name || err.Code;
  return [code, err.message].filter(Boolean).join(': ') || String(error);
}

function configureSes(configService: ConfigService): EmailProvider {
  const region =
    configService.get<string>('AWS_SES_REGION') ||
    configService.get<string>('AWS_REGION');
  const fromEmail =
    configService.get<string>('AWS_SES_FROM_EMAIL') ||
    configService.get<string>('SEND_IN_BLUE_FROM_EMAIL') ||
    configService.get<string>('SENDGRID_FROM_EMAIL');

  if (!region) {
    throw new Error('AWS_SES_REGION or AWS_REGION is not defined');
  }
  if (!fromEmail) {
    throw new Error('AWS_SES_FROM_EMAIL is not defined');
  }

  const ses = new SESClient({ region });

  return {
    sendEmail: async (
      to: string,
      templateId: number,
      params?: Record<string, any>,
    ) => {
      const templateName = buildSesTemplateName(templateId, configService);
      try {
        await ses.send(
          new SendTemplatedEmailCommand({
            Source: fromEmail,
            Destination: { ToAddresses: [to] },
            Template: templateName,
            TemplateData: JSON.stringify(params || {}),
          }),
        );
      } catch (error) {
        throw new Error(`Failed to send email: ${describeSesError(error)}`);
      }
    },
    getTemplate: async (templateId: number): Promise<EmailTemplate> => {
      const templateName = buildSesTemplateName(templateId, configService);
      try {
        const response = await ses.send(
          new GetTemplateCommand({ TemplateName: templateName }),
        );
        return {
          subject: response.Template?.SubjectPart,
          htmlContent: response.Template?.HtmlPart,
        };
      } catch (error) {
        throw new Error(`AWS SES template error: ${describeSesError(error)}`);
      }
    },
    sendCustomEmail: async (
      to: string,
      subject: string,
      htmlContent: string,
      textContent: string,
      replyTo?: string,
    ) => {
      try {
        await ses.send(
          new SendEmailCommand({
            Source: fromEmail,
            Destination: { ToAddresses: [to] },
            Message: {
              Subject: { Data: subject },
              Body: {
                Html: { Data: htmlContent },
                Text: { Data: textContent },
              },
            },
            ReplyToAddresses: replyTo ? [replyTo] : undefined,
          }),
        );
      } catch (error) {
        throw new Error(`Failed to send email: ${describeSesError(error)}`);
      }
    },
  };
}

function configureBrevo(configService: ConfigService): EmailProvider {
  const apiKey = configService.get<string>('SEND_IN_BLUE_API_KEY');
  const fromEmail =
    configService.get<string>('SEND_IN_BLUE_FROM_EMAIL') ||
    configService.get<string>('SENDGRID_FROM_EMAIL');

  if (!apiKey) {
    throw new Error('SEND_IN_BLUE_API_KEY is not defined');
  }

  return {
    sendEmail: async (
      to: string,
      templateId: number,
      params?: Record<string, any>,
    ) => {
      try {
        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'api-key': apiKey,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            to: [{ email: to }],
            templateId,
            params,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
          throw new Error(await describeErrorResponse(response));
        }
      } catch (err) {
        throw new Error(`Failed to send email: ${(err as Error).message}`);
      }
    },
    getTemplate: async (
      templateId: number,
    ): Promise<{ subject?: string; htmlContent?: string }> => {
      const response = await fetch(
        `https://api.brevo.com/v3/smtp/templates/${templateId}`,
        {
          headers: {
            accept: 'application/json',
            'api-key': apiKey,
          },
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!response.ok) {
        throw new Error(`Brevo returned HTTP ${response.status}`);
      }
      const data = await response.json();
      return { subject: data.subject, htmlContent: data.htmlContent };
    },
    sendCustomEmail: async (
      to: string,
      subject: string,
      htmlContent: string,
      textContent: string,
      replyTo?: string,
    ) => {
      if (!fromEmail) {
        throw new Error('SEND_IN_BLUE_FROM_EMAIL is not defined');
      }
      try {
        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'api-key': apiKey,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            sender: { name: 'Agrofount', email: fromEmail },
            to: [{ email: to }],
            subject,
            htmlContent,
            textContent,
            ...(replyTo ? { replyTo: { email: replyTo } } : {}),
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
          throw new Error(await describeErrorResponse(response));
        }
      } catch (err) {
        throw new Error(`Failed to send email: ${(err as Error).message}`);
      }
    },
  };
}

export const configureSendInBlue = (configService: ConfigService) => {
  const brevo = configureBrevo(configService);
  let ses: EmailProvider | undefined;
  const getSes = () => {
    ses ??= configureSes(configService);
    return ses;
  };
  const selectProvider = (options?: EmailProviderOptions) =>
    options?.provider === 'ses' ? getSes() : brevo;

  return {
    sendEmail: (
      to: string,
      templateId: number,
      params?: Record<string, any>,
      options?: EmailProviderOptions,
    ) => selectProvider(options).sendEmail(to, templateId, params),
    getTemplate: (templateId: number) => brevo.getTemplate(templateId),
    sendCustomEmail: (
      to: string,
      subject: string,
      htmlContent: string,
      textContent: string,
      replyTo?: string,
      options?: EmailProviderOptions,
    ) =>
      selectProvider(options).sendCustomEmail(
        to,
        subject,
        htmlContent,
        textContent,
        replyTo,
      ),
  };
};

export const createOrUpdateSesTemplate = async (
  ses: SESClient,
  template: {
    templateName: string;
    subject: string;
    htmlContent: string;
    textContent?: string;
  },
) => {
  const payload = {
    TemplateName: template.templateName,
    SubjectPart: template.subject,
    HtmlPart: template.htmlContent,
    TextPart: template.textContent || '',
  };

  try {
    await ses.send(new CreateTemplateCommand({ Template: payload }));
    return 'created';
  } catch (error) {
    const err = error as Error & { name?: string };
    const alreadyExists =
      err.name === 'AlreadyExists' ||
      /already exists/i.test(err.message || String(error));
    if (!alreadyExists) throw error;
    await ses.send(new UpdateTemplateCommand({ Template: payload }));
    return 'updated';
  }
};
