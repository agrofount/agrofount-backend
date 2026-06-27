import { ConfigService } from '@nestjs/config';

export const configureSendInBlue = (configService: ConfigService) => {
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
          throw new Error(`Brevo returned HTTP ${response.status}`);
        }
      } catch (err) {
        throw new Error(`Failed to send email: ${(err as Error).message}`);
      }
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
          throw new Error(`Brevo returned HTTP ${response.status}`);
        }
      } catch (err) {
        throw new Error(`Failed to send email: ${(err as Error).message}`);
      }
    },
  };
};
