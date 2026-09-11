import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private isConnected = false;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const redisUrl = this.configService.get<string>('REDIS_URL', 'redis://localhost:6379');

    if (!redisUrl) {
      this.logger.warn('REDIS_URL not configured. Operating in in-memory fallback mode.');
      return;
    }

    try {
      const isTls = redisUrl.startsWith('rediss://') || redisUrl.includes('upstash.io');

      const options: RedisOptions = {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          if (times > 3) {
            this.logger.warn('Redis reconnection limit reached. Operating in safe fallback mode.');
            return null;
          }
          return Math.min(times * 100, 2000);
        },
        lazyConnect: true,
        ...(isTls
          ? {
              tls: {
                rejectUnauthorized: false,
              },
            }
          : {}),
      };

      this.client = new Redis(redisUrl, options);

      this.client.on('connect', () => {
        this.isConnected = true;
        this.logger.log('⚡ Connected to Redis successfully');
      });

      this.client.on('error', (err) => {
        this.isConnected = false;
        this.logger.warn(`Redis notice: ${err.message}`);
      });

      this.client.connect().catch((err) => {
        this.logger.warn(`Redis connection skipped or offline (operating in safe fallback mode): ${err.message}`);
      });
    } catch (e: any) {
      this.logger.warn(`Failed to initialize Redis client: ${e.message}`);
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
    }
  }

  // Get cached key
  async get<T = any>(key: string): Promise<T | null> {
    if (!this.isConnected || !this.client) return null;
    try {
      const data = await this.client.get(key);
      if (!data) return null;
      return JSON.parse(data);
    } catch (error) {
      return null;
    }
  }

  // Set key with optional TTL in seconds
  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    if (!this.isConnected || !this.client) return;
    try {
      const stringified = JSON.stringify(value);
      if (ttlSeconds) {
        await this.client.set(key, stringified, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, stringified);
      }
    } catch (error: any) {
      this.logger.warn(`Redis set error on ${key}: ${error.message}`);
    }
  }

  // Delete key
  async del(key: string): Promise<void> {
    if (!this.isConnected || !this.client) return;
    try {
      await this.client.del(key);
    } catch (error) {}
  }

  // High-performance attempt answer buffer
  async cacheAttemptAnswer(attemptId: string, questionId: string, optionId: string): Promise<void> {
    const key = `exambondhubd:attempt:${attemptId}:answers`;
    if (this.isConnected && this.client) {
      await this.client.hset(key, questionId, optionId);
      await this.client.expire(key, 86400); // 24 hours
    }
  }

  async getAttemptAnswers(attemptId: string): Promise<Record<string, string>> {
    const key = `exambondhubd:attempt:${attemptId}:answers`;
    if (this.isConnected && this.client) {
      return await this.client.hgetall(key);
    }
    return {};
  }
}
