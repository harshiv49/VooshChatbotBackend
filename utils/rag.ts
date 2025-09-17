// src/utils/rag.ts
import { Document } from "@langchain/core/documents";
import { OpenAIChat } from "./openai";
import { ChatMessage } from "../types";
import { RETRIEVAL_CONFIG } from "./config";
import { SessionData } from "./session";

// This is a placeholder, you would replace it with your serper/web search API call
async function performWebSearch(
  query: string
): Promise<{ results: string[]; source: string }> {
  console.log(`🌐 Web search would be performed for: ${query}`);
  return {
    results: [`Web search placeholder for: ${query}`],
    source: "web_search",
  };
}

// STEP 1: Decision Engine
export async function shouldRetrieveDocuments(
  query: string,
  sessionData: SessionData,
  openaiChat: OpenAIChat
): Promise<{
  shouldRetrieve: boolean;
  reason: string;
  useCache: boolean;
  cacheAge: number;
  cachedDocs: Document[] | null;
}> {
  const decision = {
    shouldRetrieve: true,
    reason: "initial_retrieval",
    useCache: false,
    cacheAge: 0,
    cachedDocs: null as Document[] | null,
  };

  if (sessionData.retrievalHistory.length > 0) {
    let bestConfidence = -1;
    let bestDocs: Document[] | null = null;
    let bestAge = 0;

    for (const entry of sessionData.retrievalHistory) {
      const messagesSinceRetrieval =
        sessionData.history.length - entry.messageIndex;
      const timeSinceRetrieval = Date.now() - entry.timestamp;

      if (
        messagesSinceRetrieval > RETRIEVAL_CONFIG.MAX_CONTEXT_AGE ||
        timeSinceRetrieval > 300000 // 5 minutes
      ) {
        continue;
      }

      const cachedContext = entry.documents
        .map((doc) => doc.pageContent)
        .join("\n\n");
      const confidence = await assessAnswerConfidence(
        query,
        cachedContext,
        openaiChat
      );

      if (confidence.score > bestConfidence) {
        bestConfidence = confidence.score;
        bestDocs = entry.documents;
        bestAge = messagesSinceRetrieval;
      }
    }

    if (bestConfidence > RETRIEVAL_CONFIG.CONFIDENCE_THRESHOLD) {
      decision.shouldRetrieve = false;
      decision.reason = `high_confidence_with_cache_${bestConfidence.toFixed(
        2
      )}`;
      decision.useCache = true;
      decision.cacheAge = bestAge;
      decision.cachedDocs = bestDocs;
      console.log(
        `🧠 Decision: Using cached context (confidence: ${bestConfidence.toFixed(
          2
        )})`
      );
      return decision;
    }
  }

  console.log(`🔍 Decision: Retrieving new documents (${decision.reason})`);
  return decision;
}

// STEP 2: Confidence Assessment
export async function assessAnswerConfidence(
  query: string,
  context: string,
  openaiChat: OpenAIChat
): Promise<{ level: string; score: number }> {
  try {
    const confidence = await openaiChat.assessConfidence(query, context);
    const confidenceScores: { [key: string]: number } = {
      HIGH: 0.9,
      MEDIUM: 0.7,
      LOW: 0.4,
    };
    const score = confidenceScores[confidence] || 0.7;

    console.log(`🎯 Confidence assessment: ${confidence} (${score})`);
    return { level: confidence, score };
  } catch (error) {
    console.log("⚠️ Confidence assessment failed, assuming MEDIUM");
    return { level: "MEDIUM", score: 0.7 };
  }
}

// Generate response using OpenAI Chat
export async function generateChatResponse(
  query: string,
  context: string,
  conversationHistory: ChatMessage[],
  openaiChat: OpenAIChat
): Promise<string> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are a helpful news assistant. Answer user questions based on the provided context from news articles. Be conversational, accurate, and cite relevant information from the context when possible.",
    },
  ];

  const recentHistory = conversationHistory.slice(-6);
  recentHistory.forEach((msg) => {
    messages.push({
      role: msg.role === "user" ? "user" : "assistant",
      content: msg.content,
    });
  });

  messages.push({
    role: "user",
    content: `Context from news articles:\n${context}\n\nUser Question: ${query}`,
  });

  try {
    const response = await openaiChat.generateResponse(messages, 0.7, 800);
    return response;
  } catch (error: any) {
    console.error("OpenAI generation error:", error);
    throw new Error("Failed to generate response");
  }
}
