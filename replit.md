# ASK THEM - Philosophical AI Platform

## Overview
ASK THEM is a comprehensive philosophical AI platform that allows users to interact with 50+ philosophers through AI-powered chat, generate dialogues, debates, interviews, and academic papers grounded in actual philosophical writings.

## Architecture

### Frontend (React + TypeScript)
- Single-page application with all features visible on one scrollable page
- All sections support: streaming output, copy to clipboard, download, and clear functionality
- Content transfer between sections (e.g., send chat response to Model Builder)
- Uses Tailwind CSS for styling with dark/light mode support
- TanStack Query for data fetching

### Backend (Express + TypeScript)
- All endpoints stream responses using Server-Sent Events (SSE)
- Connects to external PostgreSQL database for philosopher data
- Integrates with OpenAI and Anthropic APIs for AI generation
- Automatic file ingestion from `ingest/` folder

## Key Features (in order on page)
1. **Main Chat (Kuczynski default)** - Chat with philosophers grounded in their writings
2. **Model Builder** - Build formal/informal logical models
3. **Dialogue Creator** - Generate philosophical dialogues (100-50,000 words)
4. **Debate Creator** - Generate structured debates (1500-2500 words)
5. **Interview Creator** - Generate interview-format discussions (500-50,000 words)
6. **Quote Generator** - Extract quotes from uploaded documents
7. **Position Generator** - Retrieve philosophical positions from database
8. **Argument Generator** - Retrieve and format arguments from database
9. **Outline Generator** - Generate structured outlines
10. **Full Document Generator** - Generate comprehensive documents (100-50,000 words)
11. **AI Chat** - General purpose AI assistant

## Ingest Folder

Drop files into the `ingest/` folder to automatically import data into the database.

### File Naming Convention
Files must follow this format: `AUTHOR_TYPE_N.txt`

Examples:
- `Kuczynski_QUOTES_1.txt` - Quotes from Kuczynski
- `Kuczynski_POSITIONS_1.txt` - Philosophical positions
- `Kuczynski_ARGUMENTS_1.txt` - Arguments
- `Kuczynski_WORKS_1.txt` - Works/writings

### Supported Types
- **QUOTES** - One quote per line
- **POSITIONS** - One position per line
- **ARGUMENTS** - One argument per line
- **WORKS** - Text content from works

### How It Works
1. Drop files into the `ingest/` folder
2. System automatically scans every 10 seconds
3. Files are parsed and inserted into the database
4. Processed files are moved to `ingest/processed/`

### API Endpoints
- `POST /api/ingest` - Manually trigger ingestion
- `GET /api/ingest/status` - Check pending/processed files

## Environment Variables Required
- `EXTERNAL_DATABASE_URL` - PostgreSQL connection string to philosopher database
- `OPENAI_API_KEY` - OpenAI API key for GPT models
- `ANTHROPIC_API_KEY` - Anthropic API key for Claude models

## Database Tables (External)
- `positions` - Philosophical positions from thinkers
- `quotes` - Quotations from philosophical works
- `arguments` - Philosophical arguments
- `works` - Full text content from works
- `text_chunks` - Text segments for RAG functionality

## API Endpoints

### Chat
- `POST /api/figures/:figureId/chat` - Chat with a philosopher (streaming)

### Generation (all streaming)
- `POST /api/model-builder` - Build logical models
- `POST /api/dialogue/generate` - Generate dialogues
- `POST /api/debate/generate` - Generate debates
- `POST /api/interview/generate` - Generate interviews
- `POST /api/outline/generate` - Generate outlines
- `POST /api/document/generate` - Generate full documents
- `POST /api/ai/chat` - General AI chat

### Data Retrieval
- `GET /api/figures` - List all philosophers
- `POST /api/positions/generate` - Get positions from database
- `POST /api/arguments/generate` - Get arguments from database
- `POST /api/quotes/extract` - Extract quotes from text
- `POST /api/parse-file` - Parse uploaded files for quotes

### Ingestion
- `POST /api/ingest` - Manually trigger file ingestion
- `GET /api/ingest/status` - Get ingestion status and pending files

## Development
- Run `npm run dev` to start the development server
- Frontend runs on port 5000
- Backend API prefixed with `/api`

## Cross-Chunk Coherence (CC) System

For outputs > 500 words, the app uses a three-pass architecture to ensure coherent long-form generation:

### The Three Passes

**PASS 1 - SKELETON EXTRACTION:**
- Extracts thesis, outline, key terms, commitments from database content
- Creates a "map" that constrains all subsequent generation
- Stored and retrieved from database (not memory)

**PASS 2 - CONSTRAINED CHUNK PROCESSING:**
- Divides target output into ~1000 word chunks
- Each chunk retrieves skeleton from database
- Each chunk is constrained: "Do not contradict skeleton"
- Chunks are streamed to user in real-time
- 15-second pause between chunks for rate limiting

**PASS 3 - STITCH AND VERIFY:**
- Checks total word count against target
- Generates additional content if shortfall detected
- Reports final word count

### Service Files
- `server/services/coherenceService.ts` - Main coherence logic
- `server/services/aiProviderService.ts` - Unified LLM interface

### Database Tables
- `coherence_sessions` - Tracks generation jobs
- `coherence_chunks` - Stores processed chunks
- `stitch_results` - Stores conflict detection results

## Design Decisions
- All sections on one page (no tabs/popups)
- Big inputs, big outputs
- Streaming for all AI-generated content
- Clear all functionality for entire app and individual sections
- Copy/download for each section's output
- Content can be transferred between sections (e.g., chat to Model Builder)
- Kuczynski is an Epistemic Engineer, not a philosopher
- All thinkers displayed by last name only
- Cross-Chunk Coherence (CC) for outputs > 500 words
- White background (light theme) by default for accessibility
