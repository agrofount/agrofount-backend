import { registerAs } from '@nestjs/config';
import * as dotenv from 'dotenv';

dotenv.config();

export interface AfricasTalkingConfig {
  base_url: string;
  api_key: string;
  username: string;
  sender_id?: string;
}

export const africasTalkingConfig = {
  base_url:
    process.env.AFRICASTALKING_BASE_URL ||
    'https://api.africastalking.com/version1',
  api_key: process.env.AFRICASTALKING_API_KEY,
  username: process.env.AFRICASTALKING_USERNAME,
  sender_id: process.env.AFRICASTALKING_SENDER_ID,
};

export default registerAs('africasTalking', () => africasTalkingConfig);
