import { Store, SessionData } from "hono-sessions";
import type { Redis } from 'ioredis';

interface RedisStoreOptions {
  client: Redis;
  prefix: string;
  ttl: number;
}

export class RedisStoreAdapter implements Store {
  private readonly prefix: string;
  private readonly ttl: number;
  private readonly redisClient: Redis;

  constructor(options: RedisStoreOptions) {
    this.prefix = options.prefix;
    this.ttl = options.ttl;
    this.redisClient = options.client;
  }

  private getKey(sessionId: string): string {
    return `${this.prefix}${sessionId}`;
  }

  async getSessionById(sessionId: string): Promise<SessionData | null | undefined> {
    if (!sessionId?.trim()) {
      return null;
    }

    try {
      const key = this.getKey(sessionId);
      const result = await this.redisClient.get(key);
      return result ? JSON.parse(result) : null;
    } catch (error) {
      console.error(`取得 session ${sessionId} 失敗:`, error);
      return null;
    }
  }

  async createSession(sessionId: string, initialData: SessionData): Promise<void> {
    if (!sessionId?.trim()) {
      return;
    }

    try {
      const key = this.getKey(sessionId);
      await this.redisClient.setex(key, this.ttl, JSON.stringify(initialData));
    } catch (error) {
      console.error(`建立 session ${sessionId} 失敗:`, error);
      throw error;
    }
  }
  
  async deleteSession(sessionId: string): Promise<void> {
    if (!sessionId?.trim()) {
      return;
    }

    try {
      const key = this.getKey(sessionId);
      await this.redisClient.unlink(key);
    } catch (error) {
      console.error(`刪除 session ${sessionId} 失敗:`, error);
      throw error;
    }
  }

  async persistSessionData(sessionId: string, sessionData: SessionData): Promise<void> {
    if (!sessionId?.trim()) {
      return;
    }

    try {
      const key = this.getKey(sessionId);
      await this.redisClient.setex(key, this.ttl, JSON.stringify(sessionData));
    } catch (error) {
      console.error(`儲存 session ${sessionId} 失敗:`, error);
      throw error;
    }
  }
}