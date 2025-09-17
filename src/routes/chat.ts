// src/routes/chat.ts
import { Router } from "express";
import { Document } from "@langchain/core/documents";
import axios from "axios";
import { getSessionData, saveSessionData } from "../utils/session.js";
import {
  shouldRetrieveDocuments,
  assessAnswerConfidence,
} from "../utils/rag.js";
import { RETRIEVAL_CONFIG } from "../utils/config.js";
import { OpenAIChat } from "../utils/openai.js";
import { FaissStore } from "@langchain/community/vectorstores/faiss";
import { CustomOpenAIEmbeddings } from "../embeddings.js";
import fs from "fs";
import { ChatMessage, SerperResponse } from "../types.js";
import prisma from "../utils/prisma.js";
import { Role } from "@prisma/client";

const chatRouter = Router();

let vectorStore: FaissStore | null = null;
let openaiChat: OpenAIChat | null = null;
let embeddings: CustomOpenAIEmbeddings | null = null;

function saveMessagesToDb(
  sessionId: string,
  userContent: string,
  assistantContent: string
) {
  prisma.message
    .createMany({
      data: [
        { sessionId, content: userContent, role: Role.USER },
        { sessionId, content: assistantContent, role: Role.ASSISTANT },
      ],
    })
    .catch((dbError) => {
      console.error("Database save error:", dbError);
    });
}

// --- THIS FUNCTION IS NOW FULLY RESTORED ---
async function performWebSearch(query: string): Promise<Document[]> {
  if (!process.env.SERPER_API_KEY) {
    console.error(
      "SERPER_API_KEY not found in environment variables. Skipping web search."
    );
    return [];
  }
  try {
    console.log(`Executing web search for: "${query}"`);
    const response = await axios.post<SerperResponse>(
      "https://google.serper.dev/search",
      { q: query },
      {
        headers: {
          "X-API-KEY": process.env.SERPER_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );
    const organicResults = response.data.organic || [];
    if (organicResults.length === 0) return [];
    return organicResults.slice(0, 5).map(
      (result) =>
        new Document({
          pageContent: `Title: ${result.title}\nSnippet: ${result.snippet}`,
          metadata: {
            source: result.link,
            title: result.title,
            type: "web_search",
          },
        })
    );
  } catch (error: any) {
    console.error("Serper API Error:", error.response?.data || error.message);
    return [];
  }
}

// --- THIS FUNCTION IS NOW FULLY RESTORED ---
export async function initializeVectorStoreAndOpenAI() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not found in environment variables");
  }

  embeddings = new CustomOpenAIEmbeddings(process.env.OPENAI_API_KEY, {
    model: "text-embedding-3-small",
    timeout: 30000,
  });

  openaiChat = new OpenAIChat(process.env.OPENAI_API_KEY, {
    model: "gpt-3.5-turbo",
    timeout: 30000,
  });

  const storePath = "./faiss_store";
  if (fs.existsSync(storePath)) {
    console.log("Loading existing vector store...");
    vectorStore = await FaissStore.load(storePath, embeddings);
    console.log("Vector store loaded and ready.");
  } else {
    throw new Error("Vector store not found - run index_creator.js first");
  }
}

chatRouter.post("/", async (req, res) => {
  const { query, sessionId, k = 5 } = req.body;

  if (!query || !sessionId) {
    return res.status(400).json({ error: "Query and sessionId are required" });
  }
  if (!vectorStore || !openaiChat) {
    return res.status(503).json({ error: "RAG system not fully initialized" });
  }

  try {
    console.log(`Processing: "${query}" [${sessionId.slice(0, 8)}...]`);

    const sessionData = await getSessionData(sessionId);
    let conversationHistory: ChatMessage[] = [];

    if (sessionData.history && sessionData.history.length > 0) {
      conversationHistory = sessionData.history;
    } else {
      const dbHistory = await prisma.message.findMany({
        where: { sessionId },
        orderBy: { timestamp: "asc" },
      });
      conversationHistory = dbHistory.map((msg) => ({
        role: msg.role.toLowerCase() as "user" | "assistant",
        content: msg.content,
      }));
      sessionData.history = conversationHistory;
    }

    const decision = await shouldRetrieveDocuments(
      query,
      sessionData,
      openaiChat
    );
    let relevantDocs: Document[] = [];
    let context = "";

    if (decision.shouldRetrieve) {
      const docsWithScores = await vectorStore.similaritySearchWithScore(
        query,
        k
      );
      relevantDocs = docsWithScores.map(([doc]) => doc);
    } else {
      relevantDocs = decision.cachedDocs || [];
    }
    context = relevantDocs
      .map((doc, i) => `Document ${i + 1}: ${doc.pageContent}`)
      .join("\n\n");

    const confidence = await assessAnswerConfidence(query, context, openaiChat);
    if (confidence.score < RETRIEVAL_CONFIG.CONFIDENCE_THRESHOLD) {
      const webDocs = await performWebSearch(query);
      if (webDocs.length > 0) {
        const webContext = webDocs
          .map((doc, i) => `Web Result ${i + 1}: ${doc.pageContent}`)
          .join("\n\n");
        context = `[Web Search Results]\n${webContext}\n\n[Original Retrieved Documents]\n${context}`;
        relevantDocs.unshift(...webDocs);
      }
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const systemPrompt = `You are an intelligent assistant. Use the following context to answer the user's question. If the context doesn't have the answer, say you don't know. Context: ${context}`;
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...conversationHistory,
      { role: "user", content: query },
    ];

    let fullResponse = "";
    await openaiChat.generateStreamResponse(
      messages,
      (token) => {
        res.write(`data: ${JSON.stringify({ token })}\n\n`);
        fullResponse += token;
      },
      () => {
        res.write(`data: [DONE]\n\n`);
        res.end();
        if (fullResponse) {
          saveMessagesToDb(sessionId, query, fullResponse);
          conversationHistory.push(
            { role: "user", content: query },
            { role: "assistant", content: fullResponse }
          );
          sessionData.history = conversationHistory;
          if (decision.shouldRetrieve) {
            sessionData.retrievalHistory.push({
              query,
              documents: relevantDocs,
              timestamp: Date.now(),
              messageIndex: conversationHistory.length - 2,
            });
          }
          saveSessionData(sessionId, sessionData);
        }
      },
      (error) => {
        console.error("Streaming error:", error);
        res.end();
      }
    );
  } catch (error: any) {
    console.error("Chat route error:", error.message);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Failed to process chat message",
        details: error.message,
      });
    } else {
      res.end();
    }
  }
});

export default chatRouter;
