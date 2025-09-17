// embeddings.ts - Simple OpenAI implementation
import axios from "axios";

// Interfaces for type safety
interface OpenAIEmbeddingsData {
  embedding: number[];
  index: number;
  object: string;
}

interface OpenAIEmbeddingsResponse {
  data: OpenAIEmbeddingsData[];
  model: string;
  object: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIEmbeddingsOptions {
  model?: string;
  timeout?: number;
}

class CustomOpenAIEmbeddings {
  private apiKey: string;
  private baseURL: string;
  private model: string;
  private timeout: number;

  // initialize the class
  constructor(apiKey: string, options: OpenAIEmbeddingsOptions = {}) {
    this.apiKey = apiKey;
    this.baseURL = "https://api.openai.com/v1/embeddings";
    this.model = options.model || "text-embedding-3-small"; // Cheaper than ada-002
    this.timeout = options.timeout || 30000;
  }

  private async _embed(texts: string | string[]): Promise<number[][]> {
    try {
      const response = await axios.post<OpenAIEmbeddingsResponse>(
        this.baseURL,
        {
          model: this.model,
          input: Array.isArray(texts) ? texts : [texts],
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          timeout: this.timeout,
        }
      );

      return response.data.data.map((item) => item.embedding);
    } catch (error: any) {
      console.error("OpenAI Embeddings Error:", error.message);
      throw new Error(
        `OpenAI API error: ${error.response?.status || "Unknown"} ${
          error.response?.statusText || error.message
        }`
      );
    }
  }

  async embedQuery(text: string): Promise<number[]> {
    const embeddings = await this._embed([text]);
    return embeddings[0];
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    const batchSize = 100;
    const results: number[][] = [];

    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize);
      // after batching documents we embed them
      const batchEmbeddings = await this._embed(batch);
      results.push(...batchEmbeddings);

      if (i + batchSize < documents.length) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    return results;
  }

  async verifyCompatibility(): Promise<boolean> {
    try {
      console.log("Testing OpenAI API connectivity...");
      const testEmbedding = await this.embedQuery("test");
      console.log("OpenAI API is working correctly");
      console.log(`Embedding dimension: ${testEmbedding.length}`);
      return true;
    } catch (error: any) {
      console.error("OpenAI API compatibility check failed:", error.message);
      throw new Error("Embedding compatibility check failed");
    }
  }
}

export { CustomOpenAIEmbeddings };
