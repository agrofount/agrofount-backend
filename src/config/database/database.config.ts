import { registerAs } from '@nestjs/config';
import { DataSourceOptions } from 'typeorm';
import * as dotenv from 'dotenv';

dotenv.config();

export interface DatabaseConfig {
  host: string;
  port: number;
  type: string;
  username: string;
  password: string;
  name: string;
  schema: string;
  synchronize: boolean;
}

export const pgConfig: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT, 10),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  schema: process.env.DB_SCHEMA,
  synchronize: Boolean(process.env.DB_SYNCHRONIZE),
  logging: process.env.DB_LOGGING === 'true',
  // ssl: {
  //   rejectUnauthorized: false, // Allow self-signed certificates
  // },
};

export default registerAs('database', () => pgConfig);
