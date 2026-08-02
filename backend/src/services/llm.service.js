const groq = require("../config/groq");

const SYSTEM_PROMPT = `You are a helpful assistant that answers questions based on the provided document context.
Rules:
- Answer ONLY using the information in the context chunks below.
- If the context does not contain enough information to answer, say "I don't have enough information in this document to answer that question." Do not guess or use outside knowledge.
- Reference page numbers naturally when relevant (e.g., "According to page 3...").
- Be concise and direct.
- If the user's message is a greeting or small talk (e.g. "hello", "hi", "thanks", "ok") rather than a real question about the document, respond warmly and briefly and invite them to ask something about the document. Do NOT say you don't have relevant information in this case — that response is for genuine questions the provided context doesn't answer.
- You only answer questions using the provided context. You cannot edit, generate, rewrite, or output a modified version of the document, even if asked.`;

const NO_CONTEXT_ANSWER =
  "I don't have relevant information in this document to answer that.";

const OUT_OF_SCOPE_ANSWER =
  "DocTalk can only answer questions about this PDF's content. It can't edit, generate, or modify documents.";

const SUMMARIZATION_SYSTEM_PROMPT = `You are a helpful assistant that summarizes documents. Summarize the following document according to the user's requested format. Base the summary only on the provided text — do not invent content not present in it. If the document consists entirely of non-substantive filler text (e.g. placeholder/lorem ipsum), state that clearly rather than fabricating real content.`;

const formatChunksForPrompt = (chunks) =>
  chunks
    .map((c, i) => `[Chunk ${i + 1}, Page ${c.pageNumber}]\n${c.content}`)
    .join("\n\n");

const buildMessages = (question, matchedChunks) => {
  const context = formatChunksForPrompt(matchedChunks);
  const userMessage = `Context:\n${context}\n\nQuestion: ${question}`;
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ];
};

const generateAnswer = async (question, matchedChunks) => {
  if (!matchedChunks || matchedChunks.length === 0) {
    return NO_CONTEXT_ANSWER;
  }

  const messages = buildMessages(question, matchedChunks);

  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages,
    temperature: 0.3,
    max_tokens: 1024,
  });

  return response.choices[0].message.content;
};

const streamAnswer = async function* (question, matchedChunks) {
  if (!matchedChunks || matchedChunks.length === 0) {
    yield NO_CONTEXT_ANSWER;
    return;
  }

  const messages = buildMessages(question, matchedChunks);

  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages,
    temperature: 0.3,
    max_tokens: 1024,
    stream: true,
  });

  for await (const chunk of response) {
    const text = chunk.choices[0]?.delta?.content;
    if (text) yield text;
  }
};

const streamSummarization = async function* (question, context) {
  if (!context || context.trim().length === 0) {
    yield NO_CONTEXT_ANSWER;
    return;
  }

  const userMessage = `Document:\n${context}\n\nRequest: ${question}`;
  const messages = [
    { role: "system", content: SUMMARIZATION_SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ];

  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages,
    temperature: 0.3,
    max_tokens: 1024,
    stream: true,
  });

  for await (const chunk of response) {
    const text = chunk.choices[0]?.delta?.content;
    if (text) yield text;
  }
};

const streamSmallTalk = async function* (question) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: question },
  ];

  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages,
    temperature: 0.3,
    max_tokens: 1024,
    stream: true,
  });

  for await (const chunk of response) {
    const text = chunk.choices[0]?.delta?.content;
    if (text) yield text;
  }
};

const CLASSIFY_SYSTEM_PROMPT = `You decide whether a user message is small talk, a real question about a document, or an out-of-scope request.
Reply with exactly one word: "QUESTION" if the message asks for information or refers to the content of a document.
Reply with "SMALL_TALK" if it is a greeting, thanks, praise, acknowledgement, or casual chat with no request for information.
Reply with "OUT_OF_SCOPE" if it asks to edit, modify, rewrite, translate, generate a new document/file, or otherwise produce altered content rather than answer a question about the existing content.`;

const classifyMessage = async (question) => {
  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
      { role: "user", content: question },
    ],
    temperature: 0,
    max_tokens: 10,
  });

  const label = (response.choices[0]?.message?.content || "").trim().toUpperCase();
  if (label.includes("SMALL_TALK")) return "SMALL_TALK";
  if (label.includes("OUT_OF_SCOPE")) return "OUT_OF_SCOPE";
  return "QUESTION";
};

module.exports = {
  generateAnswer,
  classifyMessage,
  streamAnswer,
  streamSummarization,
  streamSmallTalk,
  NO_CONTEXT_ANSWER,
  OUT_OF_SCOPE_ANSWER,
};
