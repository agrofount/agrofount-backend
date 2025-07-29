import { ConfigService } from '@nestjs/config';
import * as sgMail from '@sendgrid/mail';

export const configureSendGrid = (configService: ConfigService) => {
  const apiKey = configService.get<string>('SENDGRID_API_KEY');
  const fromEmail = configService.get<string>('SENDGRID_FROM_EMAIL');

  if (!apiKey) {
    throw new Error('SENDGRID_API_KEY is not defined');
  }

  if (!fromEmail) {
    throw new Error('SENDGRID_FROM_EMAIL is not defined');
  }

  sgMail.setApiKey(apiKey);

  return {
    sendEmail: async (
      to: string,
      subject: string,
      text: string,
      html?: string,
    ) => {
      const msg = {
        to,
        from: fromEmail,
        subject,
        text,
        html,
      };

      sgMail
        .send(msg)
        .then(() => {
          console.log('Email sent');
        })
        .catch((error) => {
          console.error(error);
          throw new Error('Failed to send email');
        });
    },
  };
};
