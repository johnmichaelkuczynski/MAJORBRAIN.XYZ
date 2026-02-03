import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, boolean, jsonb, vector } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Users table
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email"),
  firstName: text("first_name"),
  lastName: text("last_name"),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Figures (Philosophers) table
export const figures = pgTable("figures", {
  id: varchar("id").primaryKey(),
  name: text("name").notNull(),
  title: text("title"),
  bio: text("bio"),
  avatarUrl: text("avatar_url"),
});

export const insertFigureSchema = createInsertSchema(figures);
export type InsertFigure = z.infer<typeof insertFigureSchema>;
export type Figure = typeof figures.$inferSelect;

// Positions table - philosophical positions from thinkers
export const positions = pgTable("positions", {
  id: integer("id").primaryKey(),
  thinker: text("thinker").notNull(),
  positionText: text("position_text").notNull(),
  topic: text("topic"),
  sourceTextId: integer("source_text_id"),
});

export type Position = typeof positions.$inferSelect;

// Quotes table
export const quotes = pgTable("quotes", {
  id: integer("id").primaryKey(),
  thinker: text("thinker").notNull(),
  quoteText: text("quote_text").notNull(),
  topic: text("topic"),
  sourceTextId: integer("source_text_id"),
});

export type Quote = typeof quotes.$inferSelect;

// Text chunks table - for RAG
export const textChunks = pgTable("text_chunks", {
  id: integer("id").primaryKey(),
  thinker: text("thinker").notNull(),
  chunkText: text("chunk_text").notNull(),
  sourceDocument: text("source_document"),
});

export type TextChunk = typeof textChunks.$inferSelect;

// Arguments table
export const arguments_ = pgTable("arguments", {
  id: integer("id").primaryKey(),
  thinker: text("thinker").notNull(),
  argumentText: text("argument_text").notNull(),
  topic: text("topic"),
  sourceTextId: integer("source_text_id"),
});

export type Argument = typeof arguments_.$inferSelect;

// Works table
export const works = pgTable("works", {
  id: integer("id").primaryKey(),
  thinker: text("thinker").notNull(),
  workText: text("work_text").notNull(),
  title: text("title"),
  sourceDocument: text("source_document"),
});

export type Work = typeof works.$inferSelect;

// Conversations table
export const conversations = pgTable("conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"),
  figureId: varchar("figure_id"),
  title: text("title"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type Conversation = typeof conversations.$inferSelect;

// Messages table
export const messages = pgTable("messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id"),
  role: text("role").notNull(), // 'user' | 'assistant'
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type Message = typeof messages.$inferSelect;

// Persona settings table
export const personaSettings = pgTable("persona_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"),
  responseLength: text("response_length").default("medium"),
  quoteFrequency: text("quote_frequency").default("moderate"),
  selectedModel: text("selected_model").default("gpt-4o"),
  enhancedMode: boolean("enhanced_mode").default(false),
  dialogueMode: boolean("dialogue_mode").default(false),
});

export type PersonaSettings = typeof personaSettings.$inferSelect;

// Argument statements table
export const argumentStatements = pgTable("argument_statements", {
  id: integer("id").primaryKey(),
  thinker: text("thinker").notNull(),
  argumentType: text("argument_type"),
  premises: jsonb("premises"),
  conclusion: text("conclusion"),
  importance: integer("importance"),
});

export type ArgumentStatement = typeof argumentStatements.$inferSelect;

// Request/Response types for API
export const chatRequestSchema = z.object({
  message: z.string().min(1),
  conversationId: z.string().optional(),
  model: z.enum(["gpt-4o", "gpt-4o-mini", "claude-3-5-sonnet-20241022", "claude-3-opus-20240229"]).optional(),
  wordCount: z.number().min(100).max(50000).optional(),
  quoteCount: z.number().min(1).max(100).optional(),
  enhanced: z.boolean().optional(),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const modelBuilderRequestSchema = z.object({
  inputText: z.string().min(1),
  mode: z.enum(["formal", "informal"]),
  model: z.enum(["gpt-4o", "gpt-4o-mini", "claude-3-5-sonnet-20241022", "claude-3-opus-20240229"]).optional(),
});

export type ModelBuilderRequest = z.infer<typeof modelBuilderRequestSchema>;

export const dialogueRequestSchema = z.object({
  topic: z.string().min(1),
  thinkers: z.array(z.string()).min(2),
  wordCount: z.number().min(100).max(50000),
  model: z.enum(["gpt-4o", "gpt-4o-mini", "claude-3-5-sonnet-20241022", "claude-3-opus-20240229"]).optional(),
});

export type DialogueRequest = z.infer<typeof dialogueRequestSchema>;

export const interviewRequestSchema = z.object({
  topic: z.string().min(1),
  interviewee: z.string().min(1),
  interviewer: z.string().optional(),
  wordCount: z.number().min(500).max(50000),
  model: z.enum(["gpt-4o", "gpt-4o-mini", "claude-3-5-sonnet-20241022", "claude-3-opus-20240229"]).optional(),
});

export type InterviewRequest = z.infer<typeof interviewRequestSchema>;

export const debateRequestSchema = z.object({
  topic: z.string().min(1),
  debaters: z.array(z.string()).min(2).max(4),
  wordCount: z.number().min(1500).max(2500).optional(),
  model: z.enum(["gpt-4o", "gpt-4o-mini", "claude-3-5-sonnet-20241022", "claude-3-opus-20240229"]).optional(),
});

export type DebateRequest = z.infer<typeof debateRequestSchema>;

export const compareRequestSchema = z.object({
  topic: z.string().min(1),
  thinkers: z.array(z.string()).min(2),
});

export type CompareRequest = z.infer<typeof compareRequestSchema>;

export const paperWriterRequestSchema = z.object({
  topic: z.string().min(1),
  figureId: z.string().min(1),
  wordCount: z.number().min(100).max(50000),
  model: z.enum(["gpt-4o", "gpt-4o-mini", "claude-3-5-sonnet-20241022", "claude-3-opus-20240229"]).optional(),
});

export type PaperWriterRequest = z.infer<typeof paperWriterRequestSchema>;

export const quoteGeneratorRequestSchema = z.object({
  text: z.string().min(1),
});

export type QuoteGeneratorRequest = z.infer<typeof quoteGeneratorRequestSchema>;

export const positionGeneratorRequestSchema = z.object({
  topic: z.string().min(1),
  thinker: z.string().min(1),
});

export type PositionGeneratorRequest = z.infer<typeof positionGeneratorRequestSchema>;

export const argumentGeneratorRequestSchema = z.object({
  topic: z.string().min(1),
  thinker: z.string().min(1),
  argumentType: z.enum(["deductive", "inductive", "abductive"]).optional(),
});

export type ArgumentGeneratorRequest = z.infer<typeof argumentGeneratorRequestSchema>;

export const outlineGeneratorRequestSchema = z.object({
  topic: z.string().min(1),
  thinker: z.string().min(1),
  depth: z.number().min(1).max(5).optional(),
});

export type OutlineGeneratorRequest = z.infer<typeof outlineGeneratorRequestSchema>;

export const fullDocumentRequestSchema = z.object({
  topic: z.string().min(1),
  thinker: z.string().min(1),
  wordCount: z.number().min(100).max(50000),
  model: z.enum(["gpt-4o", "gpt-4o-mini", "claude-3-5-sonnet-20241022", "claude-3-opus-20240229"]).optional(),
});

export type FullDocumentRequest = z.infer<typeof fullDocumentRequestSchema>;

// List of available philosophers/thinkers
export const THINKERS = [
  { id: "adler", name: "Adler" },
  { id: "aesop", name: "Aesop" },
  { id: "allen", name: "Allen" },
  { id: "aristotle", name: "Aristotle" },
  { id: "bacon", name: "Bacon" },
  { id: "bergler", name: "Bergler" },
  { id: "bergson", name: "Bergson" },
  { id: "berkeley", name: "Berkeley" },
  { id: "confucius", name: "Confucius" },
  { id: "darwin", name: "Darwin" },
  { id: "descartes", name: "Descartes" },
  { id: "dewey", name: "Dewey" },
  { id: "dworkin", name: "Dworkin" },
  { id: "engels", name: "Engels" },
  { id: "freud", name: "Freud" },
  { id: "galileo", name: "Galileo" },
  { id: "gardner", name: "Gardner" },
  { id: "goldman", name: "Goldman" },
  { id: "hegel", name: "Hegel" },
  { id: "hobbes", name: "Hobbes" },
  { id: "hume", name: "Hume" },
  { id: "james", name: "James" },
  { id: "kant", name: "Kant" },
  { id: "kernberg", name: "Kernberg" },
  { id: "kuczynski", name: "Kuczynski" },
  { id: "laplace", name: "Laplace" },
  { id: "leibniz", name: "Leibniz" },
  { id: "luther", name: "Luther" },
  { id: "la-rochefoucauld", name: "La Rochefoucauld" },
  { id: "machiavelli", name: "Machiavelli" },
  { id: "maimonides", name: "Maimonides" },
  { id: "marden", name: "Marden" },
  { id: "marx", name: "Marx" },
  { id: "mill", name: "Mill" },
  { id: "nietzsche", name: "Nietzsche" },
  { id: "peirce", name: "Peirce" },
  { id: "plato", name: "Plato" },
  { id: "poincare", name: "Poincaré" },
  { id: "popper", name: "Popper" },
  { id: "rousseau", name: "Rousseau" },
  { id: "russell", name: "Russell" },
  { id: "sartre", name: "Sartre" },
  { id: "schopenhauer", name: "Schopenhauer" },
  { id: "smith", name: "Smith" },
  { id: "spencer", name: "Spencer" },
  { id: "stekel", name: "Stekel" },
  { id: "tocqueville", name: "Tocqueville" },
  { id: "veblen", name: "Veblen" },
  { id: "weyl", name: "Weyl" },
  { id: "whewell", name: "Whewell" },
] as const;

export type ThinkerId = typeof THINKERS[number]["id"];

// ============================================================================
// COHERENCE SYSTEM TABLES - For large-scale coherent output generation
// ============================================================================

// Coherence sessions - tracks each coherent generation job
export const coherenceSessions = pgTable("coherence_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionType: varchar("session_type", { length: 50 }).notNull(), // 'chat', 'debate', 'interview', 'dialogue', 'document'
  thinkerId: varchar("thinker_id", { length: 100 }),
  userPrompt: text("user_prompt").notNull(),
  globalSkeleton: jsonb("global_skeleton"), // The extracted skeleton
  targetWords: integer("target_words").notNull(),
  actualWords: integer("actual_words").default(0),
  totalChunks: integer("total_chunks").default(0),
  currentChunk: integer("current_chunk").default(0),
  status: varchar("status", { length: 20 }).default("pending"), // 'pending', 'skeleton', 'chunking', 'stitching', 'complete', 'failed'
  finalOutput: text("final_output"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type CoherenceSession = typeof coherenceSessions.$inferSelect;
export type InsertCoherenceSession = typeof coherenceSessions.$inferInsert;

// Coherence chunks - stores each processed chunk
export const coherenceChunks = pgTable("coherence_chunks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  chunkOutput: text("chunk_output"),
  chunkDelta: jsonb("chunk_delta"), // { claims_added, terms_used, conflicts_detected }
  wordCount: integer("word_count").default(0),
  status: varchar("status", { length: 20 }).default("pending"), // 'pending', 'processing', 'complete', 'failed'
  processedAt: timestamp("processed_at"),
});

export type CoherenceChunk = typeof coherenceChunks.$inferSelect;
export type InsertCoherenceChunk = typeof coherenceChunks.$inferInsert;

// Stitch results - stores conflict detection and repairs
export const stitchResults = pgTable("stitch_results", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull(),
  conflicts: jsonb("conflicts"),
  repairs: jsonb("repairs"),
  coherenceScore: varchar("coherence_score", { length: 20 }), // 'pass', 'needs_repair'
  createdAt: timestamp("created_at").defaultNow(),
});

export type StitchResult = typeof stitchResults.$inferSelect;
