import { registerAs } from '@nestjs/config';
import * as dotenv from 'dotenv';

dotenv.config();

export interface AppConfig {
  frontend_url: string;
  admin_frontend_url: string;
  registrationPromotion: boolean;
  registrationPromotionAmount: number;
}

export const appConfig = {
  frontend_url: process.env.FRONTEND_URL,
  admin_frontend_url: process.env.ADMIN_FRONTEND_URL,
  registrationPromotion: process.env.REGISTRATION_PROMOTION === 'true',
  registrationPromotionAmount: Number(
    process.env.REGISTRATION_PROMOTION_AMOUNT || 0,
  ),
};

export default registerAs('app', () => appConfig);
