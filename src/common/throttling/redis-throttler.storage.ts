import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import Redis from 'ioredis';

const INCREMENT_SCRIPT = `
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then
  local current = tonumber(redis.call('GET', KEYS[1]) or '0')
  return {current, redis.call('PTTL', KEYS[1]), 1, blockTtl}
end

local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local hitTtl = redis.call('PTTL', KEYS[1])
if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  return {hits, hitTtl, 1, tonumber(ARGV[3])}
end
return {hits, hitTtl, 0, 0}
`;

@Injectable()
export class RedisThrottlerStorage
  implements ThrottlerStorage, OnModuleDestroy
{
  private readonly redis: Redis;

  constructor(configService: ConfigService) {
    this.redis = new Redis(configService.getOrThrow<string>('REDIS_URL'), {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis.status === 'wait' || this.redis.status === 'end') return;
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    if (this.redis.status === 'wait') await this.redis.connect();
    const baseKey = `throttle:${throttlerName}:${key}`;
    const result = (await this.redis.eval(
      INCREMENT_SCRIPT,
      2,
      baseKey,
      `${baseKey}:blocked`,
      ttl,
      limit,
      blockDuration || ttl,
    )) as [number, number, number, number];

    return {
      totalHits: Number(result[0]),
      timeToExpire: Math.max(0, Math.ceil(Number(result[1]) / 1000)),
      isBlocked: Number(result[2]) === 1,
      timeToBlockExpire: Math.max(0, Math.ceil(Number(result[3]) / 1000)),
    };
  }
}
