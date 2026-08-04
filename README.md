# 📄 DocTalk

Chat with your PDFs. Upload a document, ask questions in plain English, and get LLM-powered answers grounded in your file — with page citations.

🔗 **Live demo:** [doctalk-app-8onp.onrender.com](https://doctalk-app-8onp.onrender.com/)

## ⚙️ Tech Stack

**Backend:** Node.js + Express · MongoDB Atlas + Mongoose (GridFS) · Atlas Vector Search · Gemini `gemini-embedding-001` · Groq `llama-3.3-70b-versatile` (SSE streaming) · Stripe · JWT + bcrypt, Google OAuth

**Frontend:** React 19 + Vite · Tailwind + shadcn/ui · TanStack Query + React Context

## 🧠 How It Works

1. 📤 **Upload** — PDF stored in GridFS, text extracted
2. ✂️ **Chunk** — split into ~600-char chunks with overlap
3. 🧬 **Embed** — each chunk embedded by Gemini (768-dim)
4. 🔎 **Vector search** — question embedded, top-5 chunks retrieved by similarity
5. 💬 **Answer** — Groq streams a grounded answer with page citations via SSE

## 📁 Folder Structure

```
backend/
├── src/
│   ├── server.js              # entry point
│   ├── config/                # db, gemini, groq, stripe, gridfs, passport, planLimits
│   ├── models/                # User, Document, Chunk, Conversation, Message, TokenBlocklist
│   ├── routes/                # auth, documents, conversations, billing, health
│   ├── controllers/           # auth, document, conversation, billing
│   ├── middleware/            # auth, upload, error, planLimits
│   └── services/              # auth, chunking, embedding, retrieval, llm, billing, email
└── tests/                     # Jest + supertest + mongodb-memory-server

frontend/
└── src/
    ├── routes/                # login, dashboard, upload, settings, document chat…
    ├── components/            # sidebar, top-bar, doc-card, ui/
    └── lib/                   # api.js, auth-context, streamMessage (SSE)
```

## 🚀 Getting Started

```bash
git clone https://github.com/Naveedsjd13/DocTalk.git
cd DocTalk/backend
npm install
cp .env.example .env   # fill in the values below
```

> 🔑 **Gemini load balancing:** embedding calls round-robin across multiple keys to multiply the free-tier 100 req/min quota. Set `GEMINI_API_KEY1` plus optional`GEMINI_API_KEY2`, `GEMINI_API_KEY3` (no underscore before the number). Any unset keys are skipped automatically.

```bash
npm run dev                    # backend

# new terminal:
cd ../frontend
npm install
npm run dev                    # set VITE_API_URL to your backend URL in frontend/.env
```

> 🧩 **Atlas Vector Search:** create a `vector_index` on the `chunks` collection — path `embedding`, **768 dimensions**, cosine similarity, filter on `documentId`.

## 🧪 Tests

```bash
cd backend && npm test
```

## 📌 Known Limitations

- Stripe webhooks not yet live-tested with a real `stripe listen` secret

## 📄 License

All rights reserved. This project is shared for portfolio/demonstration purposes — please don't reuse without permission.
