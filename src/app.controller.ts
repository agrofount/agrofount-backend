import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AppService } from './app.service';
import { DataSource } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly dataSource: DataSource,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  async healthCheck() {
    try {
      await this.dataSource.query('SELECT 1');
      const key = `health:${process.pid}`;
      await this.cacheManager.set(key, 'ok', 5_000);
      const cached = await this.cacheManager.get(key);
      await this.cacheManager.del(key);
      if (cached !== 'ok') throw new Error('Cache health check failed');
      return { status: 'ok', timestamp: new Date().toISOString() };
    } catch {
      throw new ServiceUnavailableException('Dependency health check failed');
    }
  }

  @Get('health/ready')
  readinessCheck() {
    return this.healthCheck();
  }

  @Get('health/live')
  livenessCheck() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
