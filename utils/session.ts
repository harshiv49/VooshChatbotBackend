// src/utils/session.ts
import Redis from "redis";
import { v4 as uuidv4 } from "uuid";
import { RETRIEVAL_CONFIG } from "./config";
import { ChatMessage, RetrievalEntry } from "../types";

export interface SessionData {
  history: ChatMessage[];
  retrievalHistory: RetrievalEntry[];
}

let redisClient: Redis.RedisClientType | null = null;
const inMemorySessions = new Map<string, SessionData>();

export async function initializeRedis(): Promise<void> {
  try {
    redisClient = Redis.createClient({
      url: process.env.REDIS_URL || "redis://localhost:6379",
    });

    redisClient.on("error", (err: any) => {
      console.log("⚠️ Redis fallback to in-memory:", err.message);
      redisClient = null;
    });

    await redisClient.connect();
    console.log("✅ Redis connected");
  } catch (error: any) {
    console.log("⚠️ Using in-memory storage");
    redisClient = null;
  }
}

export async function getSessionData(sessionId: string): Promise<SessionData> {
  const key = `session:${sessionId}`;
  if (redisClient) {
    try {
      const data = await redisClient.get(key);
      return data ? JSON.parse(data) : { history: [], retrievalHistory: [] };
    } catch (error: any) {
      return (
        inMemorySessions.get(sessionId) || { history: [], retrievalHistory: [] }
      );
    }
  }
  return (
    inMemorySessions.get(sessionId) || { history: [], retrievalHistory: [] }
  );
}

export async function saveSessionData(
  sessionId: string,
  data: SessionData,
  ttl: number = 3600
): Promise<void> {
  const key = `session:${sessionId}`;
  if (redisClient) {
    try {
      await redisClient.setEx(key, ttl, JSON.stringify(data));
    } catch (error: any) {
      inMemorySessions.set(sessionId, data);
    }
  } else {
    inMemorySessions.set(sessionId, data);
  }
}

export async function clearSessionData(sessionId: string): Promise<void> {
  const key = `session:${sessionId}`;
  if (redisClient) {
    await redisClient.del(key);
  } else {
    inMemorySessions.delete(sessionId);
  }
}

export function generateSessionId(): string {
  return uuidv4();
}
