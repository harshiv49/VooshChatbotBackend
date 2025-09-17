import { Document } from "@langchain/core/documents";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface RetrievalEntry {
  query: string;
  documents: Document[];
  timestamp: number;
  messageIndex: number;
}

// Define an interface for the expected structure of a single organic result
export interface SerperOrganicResult {
  title: string;
  link: string;
  snippet: string;
  position: number;
}

// Define an interface for the overall Serper API response
export interface SerperResponse {
  organic: SerperOrganicResult[];
  // You can add other potential fields here if you need them,
  // e.g., knowledgeGraph, peopleAlsoAsk, etc.
}
