import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/typeorm';
import { Connection } from 'typeorm';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

@Injectable()
export class DatabaseService implements OnModuleInit {
  constructor(
    @InjectConnection()
    private readonly connection: Connection,
  ) {}

  async onModuleInit() {
    await this.createTriggers();
  }

  private async createTriggers() {
    const triggersDir = join(
      process.cwd(),
      process.env.NODE_ENV === 'development' ? 'src' : 'dist',
      'config',
      'database',
      'triggers',
    );
    try {
      const files = readdirSync(triggersDir).filter((file) =>
        file.endsWith('.sql'),
      );

      for (const file of files) {
        const filePath = join(triggersDir, file);
        const sql = readFileSync(filePath, 'utf8');

        await this.connection.query(sql);
        console.log(`Trigger from ${file} created successfully.`);
      }
    } catch (error) {
      console.error('Failed to create database triggers:', error);
    }
  }
}
