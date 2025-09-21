# Voosh RAG Chatbot - Backend

This repository contains the Node.js/Express backend for the RAG-Powered News Chatbot. It handles the core RAG pipeline, session management, real-time communication, and persistent storage.

---

## Features

-   **Advanced RAG Pipeline**: Combines a local vector search with a confidence check and a live web search fallback to provide accurate answers.
-   **Real-time Streaming**: Uses Server-Sent Events (SSE) to stream responses token-by-token for an interactive user experience.
-   **Persistent Conversations**: Saves the full chat history to a Postgres database using the Prisma ORM.
-   **High-Performance Caching**: Leverages Redis for in-memory caching of session data and chat history to reduce database load and improve response times.
-   **Robust Session Management**: Provides clear RESTful endpoints to create, retrieve, and clear user sessions.
-   **Offline Data Processing**: Includes a dedicated script to scrape, process, and create embeddings for the knowledge base.

---

## Tech Stack

-   **Runtime**: Node.js
-   **Framework**: Express
-   **Database**: Postgres (with Neon DB)
-   **ORM**: Prisma
-   **Cache**: Redis
-   **AI Services**: OpenAI API (for LLM and Embeddings)
-   **Vector Store**: Faiss (Facebook AI Similarity Search)
-   **Web Search**: Serper API

---

## Setup and Installation

### Prerequisites:

-   Node.js (v18+)
-   `pnpm` (or `npm`/`yarn`)
-   An active Postgres database instance.
-   An active Redis instance.

### 1. Clone the repository:
```bash
git clone [https://github.com/harshiv49/VooshChatbotBackend.git](https://github.com/harshiv49/VooshChatbotBackend.git)
cd VooshChatbotBackend
```

### 2. Install dependencies 
```bash
pnpm install
```

### Set up environment variables:
Create a .env file in the root directory. You must provide the connection details for your database, Redis, and API keys.
```bash
# Example for local development
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE"
REDIS_URL="redis://:PASSWORD@HOST:PORT"

OPENAI_API_KEY="sk-..."
SERPER_API_KEY="..."
```

### Set up the database:
Run the Prisma commands to sync your schema with the database.

```bash
# This generates the Prisma Client based on your schema
npx prisma generate

# This pushes the schema to create the tables in your database
npx prisma db push
```

### Create the Vector Store Index:
This is a one-time setup command that scrapes the news articles, creates embeddings, and builds the local Faiss vector store.
```bash
pnpm run create-index
```

 ### Run the development server:
```bash
pnpm run dev
```
API Endpoints
POST /api/session/new: Creates a new chat session and returns a sessionId.

GET /api/session/:sessionId/history: Retrieves the message history for a given session.

DELETE /api/session/:sessionId: Clears all data (from DB and Cache) associated with a session.

POST









