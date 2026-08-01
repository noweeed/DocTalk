# Backend — DocTalk

Node.js / Express REST API for chatting with PDF documents. Handles auth, uploads, text chunking, embeddings, RAG-powered chat via Gemini and Groq, and Stripe subscriptions (Pro plan).

---

## Tech Stack

- **Runtime:** Node.js / Express
- **Database:** MongoDB + Mongoose
- **File Storage:** GridFS
- **Auth:** Passport.js + JWT (Google OAuth + email/password)
- **Embeddings:** Gemini (`gemini-embedding-001`)
- **LLM:** Groq (`llama-3.3-70b-versatile`)
- **Billing:** Stripe (hosted Checkout + Billing Portal, subscriptions)
- **Email:** Nodemailer (Gmail) — transactional emails (password reset / change)
- **Testing:** Jest + Supertest + mongodb-memory-server

---

## Structure

### Entry & Config (`src/server.js`, `src/config/`)

- **`server.js`** — Express bootstrap: CORS (restricted to `FRONTEND_URL`), JSON body parsing, Passport, rate limiting; mounts routes, connects to MongoDB. Mounts the Stripe webhook at `/api/billing/webhook` with `express.raw()` **before** the global `express.json()` so the raw body is available for signature verification
- **`db.js`** — Mongoose connection
- **`gemini.js`**, **`groq.js`** — LLM/embedding API clients
- **`stripe.js`** — Stripe client (from `STRIPE_SECRET_KEY`); returns `null` if the key is missing so the app still boots in test environments
- **`gridfs.js`** — GridFS bucket (`pdfs`) for PDF storage (lazy factory)
- **`passport.js`** — Google OAuth 2.0 strategy (finds or creates user, links to email)
- **`planLimits.js`** — Plan limits: free = 5 docs / 50 questions/mo, pro = unlimited
- **`resend.js`** — Unused Resend client (email currently goes through Nodemailer)

### Models (`src/models/`)

- **`User.js`** — Name, email, passwordHash, googleId, `plan`, `planStatus`, Stripe IDs (`stripeCustomerId`, `stripeSubscriptionId`, `stripeSubscriptionEndsAt`), monthly question usage
- **`Document.js`** — userId, title, pageCount, status, starred/trashed flags, `gridfsFileId`
- **`Chunk.js`** — Text chunks for RAG: content, pageNumber, embedding vector
- **`Conversation.js`** / **`Message.js`** — Chat conversation + messages with citations
- **`TokenBlocklist.js`** — Revoked JWTs (TTL auto-expiry)

### Routes (`src/routes/`)

- **`auth.routes.js`** — `signup`, `login`, `logout`, `me`, `updateMe`, avatar upload, forgot/reset/change password, Google OAuth
- **`document.routes.js`** — Upload, list, get, file download, update, trash/restore, permanent delete (plan-limit guarded)
- **`conversation.routes.js`** — Create/list/get conversations; send message (question-limit guarded)
- **`billing.routes.js`** — `GET /plan`, `POST /upgrade`, `POST /portal` (all JWT-protected). The webhook is **not** on this router — it's mounted directly in `server.js` with a raw body parser
- **`health.routes.js`** — `GET /health` → `{ status: "ok" }`

### Controllers (`src/controllers/`)

- **`auth.controller.js`** — Signup/login/logout, OAuth callback, password reset, profile update. Validates that `token`/`newPassword` are strings before DB queries (NoSQL-injection guard); returns generic `"Something went wrong"` on unexpected errors instead of leaking internal messages
- **`document.controller.js`** — Upload pipeline (store → parse → chunk → embed), list/filter, update, trash/restore/delete
- **`conversation.controller.js`** — Chat CRUD; `sendMessage` embeds the question, searches chunks, streams the LLM answer via SSE with citations (intent routing: question / summarization / small-talk)
- **`billing.controller.js`** — Plan + usage stats, Stripe Checkout/Portal redirects, webhook handler for the six Stripe subscription events

### Middleware (`src/middleware/`)

- **`auth.middleware.js`** — JWT verification + blocklist check
- **`error.middleware.js`** — Global JSON error handler
- **`upload.middleware.js`** — Multer: memory storage, 20MB limit, PDF-only (plus a 2MB image uploader for avatars)
- **`planLimits.middleware.js`** — Document/question limits with monthly reset

### Services (`src/services/`)

- **`auth.service.js`** — bcrypt hashing, JWT generation (7-day expiry, `jti` claim)
- **`chunking.service.js`** — Text normalization; 600-char chunks, 100-char overlap
- **`embedding.service.js`** — Gemini embeddings (768-dim), batched chunk embedding
- **`retrieval.service.js`** — MongoDB vector search, top-5 chunks (score ≥ 0.75), dedup
- **`llm.service.js`** — Groq answer generation (non-streaming + SSE streaming), context-only prompt with page citations, summarization + small-talk + intent classification
- **`billing.service.js`** — Stripe Checkout session creation (creates/reuses the Stripe Customer) and Billing Portal session creation
- **`email.service.js`** — Transactional emails via Nodemailer (password reset / change confirmation)

---

## How RAG Works

1. PDF upload → stored in GridFS, text extracted and chunked
2. Chunks embedded via Gemini, saved to MongoDB
3. Question embedded → vector search finds top-5 chunks
4. Chunks + question sent to Groq as context
5. Answer streamed back via SSE with page citations
6. Answer + citations persisted to the conversation

---

## How Billing Works

1. `POST /api/billing/upgrade` (JWT) → creates/reuses a Stripe Customer → returns a hosted Checkout URL
2. User pays on Stripe → Stripe sends webhooks to `/api/billing/webhook` (signature verified)
3. `checkout.session.completed` + `customer.subscription.created` set `plan: "pro"`
4. `invoice.payment_failed` → `planStatus: "past_due"` (plan stays pro while Stripe retries)
5. `POST /api/billing/portal` → Billing Portal URL (cancel / update card)
6. `customer.subscription.deleted` → `plan: "free"`, `planStatus: "canceled"`, subscription cleared
