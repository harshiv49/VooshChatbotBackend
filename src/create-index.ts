// index_creator.ts - OpenAI-only intelligent RAG system
import "dotenv/config";
import { FaissStore } from "@langchain/community/vectorstores/faiss";
import { JSONLoader } from "langchain/document_loaders/fs/json";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { OpenAIEmbeddings } from "@langchain/openai";
import fs from "fs";

const CORPUS_FILE = "embeddings/news_corpus.json";
const SAVE_PATH = "./faiss_store";

async function createAndSaveIndex(): Promise<void> {
  try {
    console.log("Starting index creation process with OpenAI embeddings...");

    if (!process.env.OPENAI_API_KEY) {
      console.error("FATAL ERROR: OPENAI_API_KEY not found in .env file.");
      console.log(
        "Get your API key from: https://platform.openai.com/api-keys"
      );
      process.exit(1);
    }

    // Check if corpus file exists
    if (!fs.existsSync(CORPUS_FILE)) {
      console.error(`FATAL ERROR: ${CORPUS_FILE} not found.`);
      console.log(
        "Make sure your news corpus file exists in the embeddings directory."
      );
      process.exit(1);
    }

    // Initialize embeddings first
    console.log("Initializing OpenAI embeddings...");
    const embeddings = new OpenAIEmbeddings({
      model: "text-embedding-3-small",
    });

    // Load documents
    console.log(`Loading documents from ${CORPUS_FILE}...`);
    const loader = new JSONLoader(CORPUS_FILE, "/content");
    const docs = await loader.load();
    console.log(`Loaded ${docs.length} documents.`);

    if (docs.length === 0) {
      console.error("No documents found in the corpus file.");
      process.exit(1);
    }

    // Split documents into chunks
    console.log("Splitting documents into chunks...");
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
      separators: ["\n\n", "\n", ".", "!", "?", ",", " ", ""],
    });

    const splits = await textSplitter.splitDocuments(docs);
    console.log(`Created ${splits.length} chunks.`);

    // Remove existing vector store if it exists
    if (fs.existsSync(SAVE_PATH)) {
      console.log("Removing existing vector store...");
      fs.rmSync(SAVE_PATH, { recursive: true, force: true });
    }

    console.log("Creating vector store... (This will take a few minutes)");
    console.log(`Using model: text-embedding-3-small (1536 dimensions)`);

    // Create vector store in batches for better memory and API management
    const batchSize = 50;
    let vectorStore: FaissStore | null = null;
    const totalBatches = Math.ceil(splits.length / batchSize);

    for (let i = 0; i < splits.length; i += batchSize) {
      const batch = splits.slice(i, i + batchSize);
      const currentBatch = Math.floor(i / batchSize) + 1;

      console.log(
        `Processing batch ${currentBatch}/${totalBatches} (${batch.length} chunks)...`
      );

      try {
        if (vectorStore === null) {
          // Create initial vector store with first batch
          console.log(`Attempting to create initial vector store...`);
          vectorStore = await FaissStore.fromDocuments(batch, embeddings);
          console.log(
            `Initial vector store created with ${batch.length} documents`
          );
        } else {
          // Add remaining batches to existing vector store
          console.log(`Attempting to add documents to vector store...`);
          await vectorStore.addDocuments(batch);
          console.log(`Added ${batch.length} documents to vector store`);
        }

        // Delay to respect OpenAI API rate limits
        if (i + batchSize < splits.length) {
          console.log("Waiting 2 seconds to respect rate limits...");
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      } catch (batchError: any) {
        console.error(
          `Error processing batch ${currentBatch}:`,
          batchError.message
        );
        // Wait longer and retry once
        console.log("Retrying after 5 seconds...");
        await new Promise((resolve) => setTimeout(resolve, 5000));
        try {
          if (vectorStore === null) {
            vectorStore = await FaissStore.fromDocuments(batch, embeddings);
          } else {
            await vectorStore.addDocuments(batch);
          }
          console.log(`Retry successful for batch ${currentBatch}`);
        } catch (retryError: any) {
          console.error(
            `Retry failed for batch ${currentBatch}:`,
            retryError.message
          );
          // Re-throw the error to be caught by the main try...catch block
          throw retryError;
        }
      }
    }

    // Save the vector store
    console.log("Saving vector store...");
    if (vectorStore) {
      await vectorStore.save(SAVE_PATH);
      console.log(`Vector store saved to ${SAVE_PATH}`);
      console.log(`Index statistics:`);
      console.log(`  - Original documents: ${docs.length}`);
      console.log(`  - Text chunks: ${splits.length}`);
      console.log(`  - Embedding model: text-embedding-3-small`);
      console.log(`  - Embedding dimensions: 1536`);
      console.log(`  - Chunk size: 1000 characters`);
      console.log(`  - Chunk overlap: 200 characters`);
    } else {
      console.error("Vector store not created. Cannot save.");
      process.exit(1);
    }

    // Test the created index
    console.log("Testing the index with sample queries...");
    const testQueries = ["test query", "news", "information"];
    for (const query of testQueries) {
      try {
        const testResults = await vectorStore.similaritySearch(query, 2);
        console.log(`Query "${query}" returned ${testResults.length} results`);
        if (testResults.length > 0) {
          console.log(
            `  - First result: "${testResults[0].pageContent.substring(
              0,
              100
            )}..."`
          );
        }
      } catch (testError: any) {
        console.log(`Test query "${query}" failed:`, testError.message);
      }
    }

    console.log(
      "Complete! You can now start the server with `ts-node server.ts`."
    );
    console.log("Your vector store is compatible with OpenAI embeddings.");
  } catch (error: any) {
    console.error("An unhandled error occurred:", error);
    // Provide helpful error messages
    if (error.message.includes("API key")) {
      console.log("Check your OpenAI API key in the .env file");
    } else if (error.message.includes("rate limit")) {
      console.log(
        "OpenAI API rate limit hit. Try again in a few minutes or upgrade your plan."
      );
    } else if (error.message.includes("timeout")) {
      console.log(
        "Request timed out. Your internet connection might be slow or the request is too large."
      );
    }
    process.exit(1);
  }
}

// Add graceful shutdown
process.on("SIGINT", () => {
  console.log("\nProcess interrupted. Cleaning up...");
  process.exit(0);
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled promise rejection:", error);
  process.exit(1);
});

createAndSaveIndex();
