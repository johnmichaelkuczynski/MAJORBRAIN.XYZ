# ASK THEM - Complete Technical Blueprint

## Overview

ASK THEM is a philosophical AI platform that allows users to interact with 50+ philosophers through AI-powered chat. The system retrieves actual philosophical content from a PostgreSQL database and uses it to ground AI responses with citations.

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND                                    │
│  client/src/                                                            │
│  ├── App.tsx (Main router)                                              │
│  ├── components/ (All UI sections)                                      │
│  └── lib/ (Utilities, streaming, API client)                            │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTP/SSE (Server-Sent Events)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                              BACKEND                                     │
│  server/                                                                │
│  ├── routes.ts (ALL API endpoints, search, answer generation)           │
│  ├── db.ts (Database connection)                                        │
│  ├── ingest.ts (File ingestion)                                         │
│  └── services/                                                          │
│      ├── coherenceService.ts (Cross-Chunk Coherence for long outputs)   │
│      └── aiProviderService.ts (OpenAI/Anthropic abstraction)            │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ SQL (Drizzle ORM)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         EXTERNAL DATABASE                                │
│  PostgreSQL (Neon) via EXTERNAL_DATABASE_URL                            │
│  Tables: positions, quotes, arguments, works, text_chunks, core_content │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## FILE TREE WITH DESCRIPTIONS

### ROOT CONFIGURATION FILES

| File | Purpose |
|------|---------|
| `package.json` | NPM dependencies and scripts. Run `npm run dev` to start. |
| `tsconfig.json` | TypeScript configuration for the project. |
| `vite.config.ts` | Vite bundler configuration for frontend. |
| `tailwind.config.ts` | Tailwind CSS configuration. |
| `drizzle.config.ts` | Database migration tool config (uses DATABASE_URL for migrations only). |
| `replit.md` | Project documentation and preferences. |

---

### SERVER FILES (Backend)

#### `server/index.ts`
**Purpose:** Entry point. Starts the Express server on port 5000.
```
- Imports routes from routes.ts
- Starts HTTP server
- Handles graceful shutdown
```

#### `server/db.ts` ⭐ CRITICAL - DATABASE CONNECTION
**Purpose:** Creates database connection using EXTERNAL_DATABASE_URL.
```typescript
// Lines 1-15
const connectionString = process.env.EXTERNAL_DATABASE_URL;
export const db = drizzle(pool);
```
**IMPORTANT:** This file uses `EXTERNAL_DATABASE_URL` (Neon PostgreSQL), NOT the Replit internal database.

#### `server/routes.ts` ⭐ CRITICAL - ALL API ENDPOINTS & ANSWER GENERATION
**Purpose:** Contains ALL API routes, database search, and answer generation logic.

| Line Range | Function | Description |
|------------|----------|-------------|
| 114-122 | `ABBREVIATION_EXPANSIONS` | Maps abbreviations like "DN" → "deductive-nomological" |
| 124-199 | `extractSearchTerms()` | Extracts keywords from user query, expands abbreviations |
| 208-349 | `getThinkerContext()` | **MAIN SEARCH FUNCTION** - Queries database for positions, quotes, arguments, works |
| 351-436 | `buildDatabaseSkeleton()` | Formats database content into skeleton for AI prompt |
| 438-528 | `buildPhilosopherSystemPrompt()` | Creates system prompt with database content and citation requirements |
| 545-700 | `POST /api/figures/:figureId/chat` | **MAIN CHAT ENDPOINT** - Streams AI response grounded in database |
| 700-900 | `POST /api/dialogue/generate` | Generates dialogues using coherence service |
| 900-1100 | `POST /api/debate/generate` | Generates debates using coherence service |
| 1100-1300 | `POST /api/interview/generate` | Generates interviews using coherence service |
| 1300-1480 | Other endpoints | Model builder, outline, document, quote generators |

**KEY SEARCH LOGIC (Lines 208-349):**
```typescript
async function getThinkerContext(thinkerId: string, query: string, quoteCount: number = 50) {
  // 1. Extract search terms with abbreviation expansion
  const searchTerms = extractSearchTerms(query);
  
  // 2. Search CORE content first (priority)
  const coreContent = await db.execute(sql`
    SELECT * FROM core_content 
    WHERE thinker ILIKE ${'%' + thinkerName + '%'}
    AND content ILIKE ${'%' + term + '%'}
  `);
  
  // 3. Search positions, quotes, arguments, works
  const relevantPositions = await db.select().from(positions)
    .where(ilike(positions.positionText, `%${term}%`))
    .limit(quoteCount);
  
  // Returns: { positions, quotes, arguments, works, coreContent }
}
```

#### `server/ingest.ts`
**Purpose:** Automatic file ingestion from `ingest/` folder.
```
- Watches ingest/ folder
- Parses files named AUTHOR_TYPE_N.txt
- Inserts into database tables
- Moves processed files to ingest/processed/
```

#### `server/storage.ts`
**Purpose:** In-memory storage interface (not used for philosopher data).

#### `server/vite.ts`
**Purpose:** Vite dev server integration with Express.

#### `server/static.ts`
**Purpose:** Static file serving for production.

---

### SERVER SERVICES

#### `server/services/coherenceService.ts` ⭐ CRITICAL - LONG OUTPUT GENERATION
**Purpose:** Cross-Chunk Coherence (CC) system for outputs >500 words.

| Function | Line | Description |
|----------|------|-------------|
| `createCoherenceSession()` | ~50 | Creates new generation session in database |
| `buildSkeleton()` | ~100 | **PASS 1:** Extracts thesis, outline, key terms from database content |
| `processChunk()` | ~200 | **PASS 2:** Generates ~1000 word chunks constrained by skeleton |
| `stitchAndVerify()` | ~350 | **PASS 3:** Verifies word count, generates additional content if needed |
| `streamCoherentResponse()` | ~450 | Main entry point - orchestrates all three passes |

**THREE-PASS ARCHITECTURE:**
```
PASS 1 - SKELETON EXTRACTION
├── Extract thesis from database content
├── Build outline structure
├── Identify key terms and commitments
└── Store skeleton in database

PASS 2 - CONSTRAINED CHUNK PROCESSING
├── Divide target into ~1000 word chunks
├── Each chunk retrieves skeleton
├── Generate chunk constrained: "Do not contradict skeleton"
└── Stream chunks to user with 15-second pauses

PASS 3 - STITCH AND VERIFY
├── Check total word count vs target
├── Generate additional content if shortfall
└── Report final word count
```

#### `server/services/aiProviderService.ts`
**Purpose:** Unified interface for OpenAI and Anthropic APIs.
```typescript
// Abstracts model selection
streamOpenAI(messages, model)
streamAnthropic(systemPrompt, messages, model)
```

---

### SHARED FILES

#### `shared/schema.ts` ⭐ CRITICAL - DATABASE SCHEMA & TYPES
**Purpose:** Drizzle ORM schema definitions for all database tables.

| Table | Purpose |
|-------|---------|
| `positions` | Philosophical positions from thinkers (id, thinker, positionText, topic) |
| `quotes` | Quotations from works (id, thinker, quoteText, source) |
| `arguments_` | Philosophical arguments (id, thinker, argumentText, topic) |
| `works` | Full text excerpts (id, thinker, workText, title) |
| `text_chunks` | Text segments for RAG (id, thinker, content, embedding) |
| `core_content` | Priority content from Document Analyzer (id, thinker, content, content_type, priority) |
| `coherence_sessions` | Tracks CC generation jobs |
| `coherence_chunks` | Stores processed chunks |
| `stitch_results` | Stores conflict detection results |

**Also exports:**
- `THINKERS` array - List of 50+ philosophers with IDs and names
- Zod schemas for request validation
- Insert/Select types for each table

---

### CLIENT FILES (Frontend)

#### `client/src/main.tsx`
**Purpose:** React entry point. Renders App component.

#### `client/src/App.tsx`
**Purpose:** Main app layout with all sections on one scrollable page.

#### `client/src/lib/queryClient.ts`
**Purpose:** TanStack Query client for API requests.

#### `client/src/lib/streaming.ts`
**Purpose:** SSE (Server-Sent Events) streaming utilities.

#### `client/src/lib/content-transfer.tsx`
**Purpose:** Allows transferring content between sections.

---

### CLIENT COMPONENTS (Feature Sections)

| File | Description |
|------|-------------|
| `main-chat-section.tsx` | Main philosopher chat (Kuczynski default) |
| `model-builder-section.tsx` | Logical model building |
| `dialogue-creator-section.tsx` | Philosophical dialogue generation |
| `debate-creator-section.tsx` | Structured debate generation |
| `interview-creator-section.tsx` | Interview-format discussions |
| `quote-generator-section.tsx` | Quote extraction from documents |
| `position-generator-section.tsx` | Retrieve positions from database |
| `argument-generator-section.tsx` | Retrieve arguments from database |
| `outline-generator-section.tsx` | Generate structured outlines |
| `full-document-section.tsx` | Generate comprehensive documents |
| `document-analyzer-section.tsx` | Analyze documents for CORE content |
| `ai-chat-section.tsx` | General purpose AI assistant |

---

## ANSWER GENERATION FLOW (Chat)

```
1. USER SUBMITS QUESTION
   └── POST /api/figures/kuczynski/chat
       Body: { message: "What is the DN model?", model: "gpt-4o" }

2. EXTRACT SEARCH TERMS (server/routes.ts:124-199)
   └── extractSearchTerms("What is the DN model?")
       ├── Tokenize: ["what", "dn", "model"]
       ├── Remove stopwords: ["dn", "model"]
       └── Expand abbreviations: ["dn", "deductive-nomological", "deductive", "nomological", "model"]

3. QUERY DATABASE (server/routes.ts:208-349)
   └── getThinkerContext("kuczynski", query)
       ├── Search core_content WHERE content ILIKE '%deductive-nomological%'
       ├── Search positions WHERE position_text ILIKE '%deductive-nomological%'
       ├── Search quotes WHERE quote_text ILIKE '%deductive-nomological%'
       ├── Search arguments WHERE argument_text ILIKE '%deductive-nomological%'
       └── Search works WHERE work_text ILIKE '%deductive-nomological%'
       
   RETURNS: { positions: 20, quotes: 20, arguments: 10, works: 5 }

4. BUILD SYSTEM PROMPT (server/routes.ts:438-528)
   └── buildPhilosopherSystemPrompt(context)
       ├── "You ARE Kuczynski. Speak in FIRST PERSON."
       ├── Include all database items with [P1], [Q1], [A1], [W1] codes
       └── "Cite sources. DO NOT fabricate."

5. STREAM AI RESPONSE (server/routes.ts:545-700)
   └── For short outputs: Direct streaming from OpenAI/Anthropic
   └── For outputs >500 words: Use coherenceService.streamCoherentResponse()

6. RETURN TO CLIENT
   └── SSE events: { type: "content", content: "I believe..." }
```

---

## DATABASE CONNECTION

**CRITICAL:** The application uses `EXTERNAL_DATABASE_URL` (Neon PostgreSQL), NOT the Replit internal database.

```typescript
// server/db.ts (Lines 1-15)
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

const connectionString = process.env.EXTERNAL_DATABASE_URL;

if (!connectionString) {
  throw new Error("EXTERNAL_DATABASE_URL environment variable is required");
}

const pool = new Pool({ connectionString });
export const db = drizzle(pool);
```

**Database Tables:**
```sql
-- positions table
CREATE TABLE positions (
  id SERIAL PRIMARY KEY,
  thinker VARCHAR NOT NULL,
  position_text TEXT NOT NULL,
  topic VARCHAR,
  source_text_id INTEGER
);

-- quotes table
CREATE TABLE quotes (
  id SERIAL PRIMARY KEY,
  thinker VARCHAR NOT NULL,
  quote_text TEXT NOT NULL,
  source VARCHAR
);

-- arguments table
CREATE TABLE arguments (
  id SERIAL PRIMARY KEY,
  thinker VARCHAR NOT NULL,
  argument_text TEXT NOT NULL,
  topic VARCHAR
);

-- works table
CREATE TABLE works (
  id SERIAL PRIMARY KEY,
  thinker VARCHAR NOT NULL,
  work_text TEXT NOT NULL,
  title VARCHAR
);

-- core_content table (PRIORITY - searched first)
CREATE TABLE core_content (
  id SERIAL PRIMARY KEY,
  thinker VARCHAR NOT NULL,
  content TEXT NOT NULL,
  content_type VARCHAR, -- 'position', 'argument', 'trend', 'qa', 'outline'
  priority INTEGER DEFAULT 1
);
```

---

## ENVIRONMENT VARIABLES

| Variable | Purpose | Used In |
|----------|---------|---------|
| `EXTERNAL_DATABASE_URL` | PostgreSQL connection string (Neon) | server/db.ts |
| `OPENAI_API_KEY` | OpenAI API access | server/routes.ts |
| `ANTHROPIC_API_KEY` | Anthropic API access | server/routes.ts |
| `SESSION_SECRET` | Session management | server/index.ts |

---

## KEY FUNCTIONS QUICK REFERENCE

### Database Search
| Function | File | Line | Description |
|----------|------|------|-------------|
| `extractSearchTerms()` | server/routes.ts | 124 | Parse query into search terms |
| `getThinkerContext()` | server/routes.ts | 208 | Query all tables for relevant content |
| `buildDatabaseSkeleton()` | server/routes.ts | 351 | Format content for AI prompt |

### Answer Generation
| Function | File | Line | Description |
|----------|------|------|-------------|
| `buildPhilosopherSystemPrompt()` | server/routes.ts | 438 | Create system prompt with citations |
| `streamOpenAI()` | server/routes.ts | 36 | Stream from GPT models |
| `streamAnthropic()` | server/routes.ts | 56 | Stream from Claude models |
| `streamCoherentResponse()` | server/services/coherenceService.ts | 450 | Three-pass coherent generation |

### API Endpoints
| Endpoint | File | Line | Description |
|----------|------|------|-------------|
| `POST /api/figures/:id/chat` | server/routes.ts | 545 | Main chat endpoint |
| `POST /api/dialogue/generate` | server/routes.ts | 700 | Dialogue generation |
| `POST /api/debate/generate` | server/routes.ts | 900 | Debate generation |
| `POST /api/interview/generate` | server/routes.ts | 1100 | Interview generation |

---

## RUNNING THE APPLICATION

```bash
# Start development server
npm run dev

# The app runs on http://localhost:5000
# Frontend and backend are served from the same port
```

---

## RECENT FIX (February 4, 2026)

**Problem:** Queries like "DN model" weren't finding "deductive-nomological" entries.

**Solution:** Added abbreviation expansion in `extractSearchTerms()` (server/routes.ts:114-199):
```typescript
const ABBREVIATION_EXPANSIONS = {
  'dn': ['deductive-nomological', 'deductive', 'nomological'],
  'ocd': ['obsessive-compulsive', 'obsessive', 'compulsive'],
  // ... more expansions
};
```

Now "DN" expands to match the 142 database entries containing "deductive-nomological".
