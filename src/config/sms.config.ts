import { registerAs } from '@nestjs/config';
import * as dotenv from 'dotenv';

dotenv.config();

export type SmsProvider = 'termii' | 'africastalking';

export interface SmsConfig {
  provider: SmsProvider;
  termii: {
    base_url: string;
    api_key?: string;
    sender_id?: string;
    dnd_sender_id?: string;
  };
  africasTalking: {
    base_url: string;
    api_key?: string;
    username?: string;
    sender_id?: string;
  };
}

export const smsConfig: SmsConfig = {
  provider: ['africastalking', 'africa_talking', 'africas_talking'].includes(
    String(process.env.SMS_PROVIDER || '').toLowerCase(),
  )
    ? 'africastalking'
    : 'termii',
  termii: {
    base_url: process.env.TERMII_BASE_URL || 'https://api.ng.termii.com/api',
    api_key: process.env.TERMII_API_KEY,
    sender_id: process.env.TERMII_SENDER_ID || 'Agrofount',
    dnd_sender_id: process.env.TERMII_DND_SENDER_ID || 'N-Alert',
  },
  africasTalking: {
    base_url:
      process.env.AFRICASTALKING_BASE_URL ||
      process.env.AFRICA_TALKING_BASE_URL ||
      'https://api.africastalking.com/version1',
    api_key:
      process.env.AFRICASTALKING_API_KEY || process.env.AFRICA_TALKING_API_KEY,
    username:
      process.env.AFRICASTALKING_USERNAME ||
      process.env.AFRICA_TALKING_USERNAME,
    sender_id:
      process.env.AFRICASTALKING_SENDER_ID ||
      process.env.AFRICA_TALKING_SENDER_ID,
  },
};

export default registerAs('sms', () => smsConfig);
