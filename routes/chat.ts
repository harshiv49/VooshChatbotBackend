// src/routes/chat.ts
import { Router } from "express";
import { ChatMessage } from "../types";
import { Document } from "@langchain/core/documents";
import axios from "axios";
import { getSessionData, saveSessionData } from "../utils/session";
import {
  shouldRetrieveDocuments,
  assessAnswerConfidence,
  generateChatResponse,
} from "../utils/rag";
import { RETRIEVAL_CONFIG } from "../utils/config";
import { OpenAIChat } from "../utils/openai";
import { FaissStore } from "@langchain/community/vectorstores/faiss";
import { CustomOpenAIEmbeddings } from "../src/embeddings";
import fs from "fs";
import { SerperResponse } from "../types";
import prisma from "../utils/prisma"; // Import the Prisma client
import { Role } from "@prisma/client";

const chatRouter = Router();

let vectorStore: FaissStore | null = null;
let openaiChat: OpenAIChat | null = null;
let embeddings: CustomOpenAIEmbeddings | null = null;

/**
 * Asynchronously saves user and assistant messages to the database
 * without blocking the main request-response cycle.
 */
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

/**
 * Performs a web search using the Serper API.
 * @param query The search query.
 * @returns A promise that resolves to an array of Document objects.
 */
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

    if (organicResults.length === 0) {
      console.log("Web search returned no results.");
      return [];
    }

    // Transform top 5 Serper results into Document objects
    const documents = organicResults.slice(0, 5).map(
      (
        result // result is now correctly typed
      ) =>
        new Document({
          pageContent: `Title: ${result.title}\nSnippet: ${result.snippet}`,
          metadata: {
            source: result.link,
            title: result.title,
            type: "web_search",
          },
        })
    );

    console.log(
      `Found ${documents.length} relevant documents from web search.`
    );
    return documents;
  } catch (error: any) {
    console.error("Serper API Error:", error.response?.data || error.message);
    return []; // Return an empty array on error to not break the chat flow
  }
}

export async function initializeVectorStoreAndOpenAI() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not found in environment variables");
  }
  if (!process.env.SERPER_API_KEY) {
    console.warn(
      "SERPER_API_KEY not found. Web search fallback will be disabled."
    );
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
    vectorStore = await FaissStore.load(storePath, embeddings);
    console.log("Vector store loaded and ready.");
  } else {
    throw new Error("Vector store not found - run index_creator.js first");
  }
}

chatRouter.post("/", async (req, res) => {
  try {
    const { query, sessionId, k = 5 } = req.body;

    if (!query || !sessionId) {
      return res
        .status(400)
        .json({ error: "Query and sessionId are required" });
    }

    if (!vectorStore || !openaiChat) {
      return res
        .status(503)
        .json({ error: "RAG system not fully initialized" });
    }

    console.log(`Processing: "${query}" [${sessionId.slice(0, 8)}...]`);

    // Fetch session cache (retrieval history) from Redis
    const sessionData = await getSessionData(sessionId);
    // Fetch message history from the database
    const dbHistory = await prisma.message.findMany({
      where: { sessionId },
      orderBy: { timestamp: "asc" },
    });
    // Map db format to the format expected by the chat model
    const conversationHistory: ChatMessage[] = dbHistory.map((msg) => ({
      role: msg.role.toLowerCase() as "user" | "assistant",
      content: msg.content,
    }));

    const retrievalInfo = {
      decision: null,
      documentsUsed: "cached",
      confidence: null,
      webSearchUsed: false,
    };

    const decision = await shouldRetrieveDocuments(
      query,
      sessionData,
      openaiChat
    );
    retrievalInfo.decision = decision as any;

    let relevantDocs: Document[] = [];
    let context = "";

    if (decision.shouldRetrieve) {
      const docsWithScores = await vectorStore.similaritySearchWithScore(
        query,
        k
      );
      relevantDocs = docsWithScores.map(([doc]) => doc);

      context = relevantDocs
        .map((doc, index) => `Document ${index + 1}: ${doc.pageContent}`)
        .join("\n\n");

      sessionData.retrievalHistory.push({
        query,
        documents: relevantDocs,
        timestamp: Date.now(),
        messageIndex: conversationHistory.length,
      });

      if (
        sessionData.retrievalHistory.length >
        RETRIEVAL_CONFIG.MAX_RETRIEVAL_HISTORY
      ) {
        sessionData.retrievalHistory.shift();
      }

      retrievalInfo.documentsUsed = "new";
    } else {
      relevantDocs = decision.cachedDocs || [];
      context = relevantDocs
        .map((doc, index) => `Document ${index + 1}: ${doc.pageContent}`)
        .join("\n\n");
      retrievalInfo.documentsUsed = "cached";
    }

    const confidence = await assessAnswerConfidence(query, context, openaiChat);
    retrievalInfo.confidence = confidence as any;

    if (confidence.score < RETRIEVAL_CONFIG.CONFIDENCE_THRESHOLD) {
      console.log(
        `Low confidence (${confidence.score}), performing web search...`
      );
      retrievalInfo.webSearchUsed = true;

      const webDocs = await performWebSearch(query);

      if (webDocs.length > 0) {
        const webContext = webDocs
          .map((doc, index) => `Web Result ${index + 1}: ${doc.pageContent}`)
          .join("\n\n");

        context = `[Web Search Results]\n${webContext}\n\n[Original Retrieved Documents]\n${context}`;
        relevantDocs.unshift(...webDocs);
      }
    }

    const aiResponse = await generateChatResponse(
      query,
      context,
      conversationHistory,
      openaiChat
    );

    // Asynchronously save messages to DB without awaiting
    saveMessagesToDb(sessionId, query, aiResponse);

    // Save only the retrieval history back to Redis, not the message history
    await saveSessionData(sessionId, {
      ...sessionData,
      history: [], // Clear history from Redis cache object
    });

    res.json({
      sessionId,
      query,
      response: aiResponse,
      retrievalInfo,
      sources: relevantDocs.slice(0, 3).map((doc, index) => ({
        id: index + 1,
        content: doc.pageContent.substring(0, 150) + "...",
        metadata: doc.metadata,
      })),
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("Chat error:", error.message);
    res.status(500).json({
      error: "Failed to process chat message",
      details: error.message,
    });
  }
});

export default chatRouter;
