import { ConfigService } from '@nestjs/config';
import * as AfricasTalking from 'africastalking';

export const configureAfricasTalking = (configService: ConfigService) => {
  const apiKey = configService.get<string>('AFRICA_TALKING_API_KEY');
  const username = configService.get<string>('AFRICA_TALKING_USERNAME');
  const from = configService.get<string>('AFRICA_TALKING_SENDER_ID');

  if (!apiKey) {
    throw new Error('AFRICA_TALKING_API_KEY is not defined');
  }

  const africastalking = AfricasTalking({
    apiKey: apiKey,
    username: username,
  });

  return {
    sendSms: async (to: string[], message: string) => {
      const sms = africastalking.SMS;

      console.log('this is the sms payload: ', {
        to,
        message,
        from,
      });

      const options = {
        to,
        message,
      };

      try {
        const response = await sms.send(options);
        console.log('SMS sent:', response);
        return response;
      } catch (error) {
        console.error('Error sending SMS:', error);
        throw new Error('Failed to send SMS');
      }
    },
  };
};
