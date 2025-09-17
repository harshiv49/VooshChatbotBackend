import { ChatMessage } from "../types.js";
// OpenAI API helper class for chat completions
export class OpenAIChat {
  private apiKey: string;
  private baseURL: string;
  private model: string;
  private timeout: number;

  constructor(
    apiKey: string,
    options: { model?: string; timeout?: number } = {}
  ) {
    this.apiKey = apiKey;
    this.baseURL = "https://api.openai.com/v1/chat/completions";
    this.model = options.model || "gpt-3.5-turbo";
    this.timeout = options.timeout || 30000;
  }

  // Standard non-streaming method (optional, but good to have)
  async generateResponse(
    messages: ChatMessage[],
    temperature: number = 0.7,
    maxTokens: number = 1000
  ): Promise<string> {
    try {
      const response = await fetch(this.baseURL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: messages,
          temperature: temperature,
          max_tokens: maxTokens,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `OpenAI API error: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data = await response.json();
      return data.choices[0].message.content;
    } catch (error: any) {
      console.error("OpenAI Chat API Error:", error.message);
      throw new Error(`OpenAI API error: ${error.message}`);
    }
  }

  // Streaming method
  async generateStreamResponse(
    messages: ChatMessage[],
    onToken: (token: string) => void,
    onComplete: () => void,
    onError: (error: any) => void
  ): Promise<void> {
    try {
      const response = await fetch(this.baseURL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: messages,
          temperature: 0.7,
          stream: true,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `OpenAI API error: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      if (!response.body) {
        throw new Error("Response body is not a readable stream.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.substring(6);
            if (data === "[DONE]") {
              onComplete();
              return;
            }
            try {
              const json = JSON.parse(data);
              const token = json.choices[0].delta.content || "";
              if (token) {
                onToken(token);
              }
            } catch (error) {
              console.error("Failed to parse JSON:", data);
            }
          }
        }
      }
    } catch (error: any) {
      console.error("OpenAI Streaming API Error:", error.message);
      onError(error);
    }
  }

  async assessConfidence(query: string, context: string): Promise<string> {
    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          "You are an AI assistant evaluating whether you can confidently answer a user's question based on provided context. Respond with only one word: HIGH, MEDIUM, or LOW.",
      },
      {
        role: "user",
        content: `Context: ${context}\n\nUser Question: ${query}\n\nRate your confidence in answering this question based ONLY on the provided context:\n- HIGH: Context contains clear, relevant information to fully answer\n- MEDIUM: Context contains some relevant information but may be incomplete\n- LOW: Context lacks sufficient relevant information\n\nConfidence:`,
      },
    ];

    try {
      const confidence = await this.generateResponse(messages, 0.1, 10);
      return confidence.trim().toUpperCase();
    } catch (error) {
      console.log("⚠️ Confidence assessment failed, assuming MEDIUM");
      return "MEDIUM";
    }
  }
}
