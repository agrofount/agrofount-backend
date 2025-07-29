import { ConfigService } from '@nestjs/config';
import * as brevo from '@getbrevo/brevo';

export const configureSendInBlue = (configService: ConfigService) => {
  const apiKey = configService.get<string>('SEND_IN_BLUE_API_KEY');

  if (!apiKey) {
    throw new Error('SEND_IN_BLUE_API_KEY is not defined');
  }

  const apiInstance = new brevo.TransactionalEmailsApi();
  apiInstance.setApiKey(brevo.TransactionalEmailsApiApiKeys.apiKey, apiKey);

  return {
    sendEmail: async (
      to: string,
      templateId: number,
      params?: Record<string, any>,
    ) => {
      const sendSmtpEmail = new brevo.SendSmtpEmail();
      sendSmtpEmail.to = [{ email: to }];

      sendSmtpEmail.templateId = templateId; // Set the predefined email template ID

      if (params) {
        sendSmtpEmail.params = params; // Pass dynamic parameters to the template
      }
      try {
        await apiInstance.sendTransacEmail(sendSmtpEmail);
        console.log('Email sent');
      } catch (error) {
        console.error(
          'Error sending email:',
          error.response ? error.response.body : error,
        );
        throw new Error('Failed to send email');
      }
    },
  };
};
