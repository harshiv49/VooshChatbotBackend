import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { initializeRedis } from "./utils/session.js";
import sessionRouter from "./routes/session.js";
import chatRouter, { initializeVectorStoreAndOpenAI } from "./routes/chat.js";

dotenv.config();

const app = express();
const PORT: number = parseInt(process.env.PORT || "8000", 10);

app.use(cors());
app.use(express.json());

// Mount the routers
app.use("/session", sessionRouter);
app.use("/chat", chatRouter);

// Health check and config endpoints
app.get("/api/health", (req, res) => {
  // We send the structure that the frontend expects
  res.json({
    status: "ok",
    features: {
      ragAvailable: true, // You can add more feature flags here in the future
    },
  });
});

app.post("/config/retrieval", (req, res) => {
  // You can implement this here, or move it to a config router if needed
  res.json({ message: "Configuration endpoint is a placeholder for now." });
});

async function main() {
  try {
    console.log("🚀 Initializing Intelligent RAG Pipeline...");
    await initializeRedis();
    await initializeVectorStoreAndOpenAI();

    app.listen(PORT, () => {
      console.log(`✅ Server is running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("🔴 Server initialization failed:", error);
    process.exit(1);
  }
}

main();
