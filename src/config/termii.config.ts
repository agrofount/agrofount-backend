import { registerAs } from '@nestjs/config';
import * as dotenv from 'dotenv';

dotenv.config();

export interface TermiiConfig {
  base_url: string;
  api_key: string;
  sender_id: string;
}

export const termiiConfig = {
  base_url: process.env.TERMII_BASE_URL,
  api_key: process.env.TERMII_API_KEY,
  sender_id: process.env.TERMII_SENDER_ID,
};

export default registerAs('termii', () => termiiConfig);
