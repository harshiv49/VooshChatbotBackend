// src/routes/session.ts
import { Router } from "express";
import {
  generateSessionId,
  getSessionData,
  clearSessionData,
} from "../utils/session";
import prisma from "../utils/prisma"; // Import the Prisma client

const sessionRouter = Router();

sessionRouter.post("/new", async (req, res) => {
  try {
    const sessionId = generateSessionId();
    // Create a new session in the database
    await prisma.session.create({
      data: {
        id: sessionId,
      },
    });
    console.log(`New session created: ${sessionId}`);
    res.json({ sessionId });
  } catch (error) {
    console.error("Failed to create new session:", error);
    res.status(500).json({ error: "Failed to create new session" });
  }
});

sessionRouter.get("/:sessionId/history", async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Fetch message history from the database
    const messages = await prisma.message.findMany({
      where: { sessionId },
      orderBy: { timestamp: "asc" },
    });

    // Fetch retrieval cache from Redis
    const sessionData = await getSessionData(sessionId);

    res.json({
      sessionId,
      history: messages, // History now comes from the database
      retrievalCache: sessionData.retrievalHistory.map((entry) => ({
        query: entry.query,
        timestamp: entry.timestamp,
        messageIndex: entry.messageIndex,
      })),
    });
  } catch (error) {
    console.error("Failed to get session history:", error);
    res.status(500).json({ error: "Failed to get session history" });
  }
});

sessionRouter.delete("/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Delete the session and its related messages from the database
    await prisma.session.delete({
      where: { id: sessionId },
    });

    // Clear any remaining session data from Redis
    await clearSessionData(sessionId);

    console.log(`Session cleared: ${sessionId}`);
    res.json({ message: "Session cleared successfully" });
  } catch (error) {
    console.error("Failed to clear session:", error);
    res.status(500).json({ error: "Failed to clear session" });
  }
});

export default sessionRouter;
