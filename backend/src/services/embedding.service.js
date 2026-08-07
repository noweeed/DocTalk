const { getNextGenAI } = require("../config/gemini");
const Chunk = require("../models/Chunk");

const BATCH_SIZE = 25;
const MAX_RETRIES = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getRetryDelayMs = (err) => {
  const detail = err?.errorDetails?.find((d) => d.retryDelay);
  if (detail?.retryDelay) {
    const seconds = parseFloat(detail.retryDelay);
    if (!Number.isNaN(seconds)) return Math.ceil(seconds * 1000) + 500; // small buffer
  }
  return 5000;
};

const embedText = async (text) => {
  const genAI = getNextGenAI();
  const model = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
  const result = await model.embedContent({
    content: { parts: [{ text }] },
    outputDimensionality: 768,
  });
  return result.embedding.values;
};

const embedTextWithRetry = async (text, retries = MAX_RETRIES) => {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await embedText(text);
    } catch (err) {
      const isLastAttempt = attempt === retries - 1;
      if (err.status === 429 && !isLastAttempt) {
        const delayMs = getRetryDelayMs(err);
        console.warn(
          `Embedding rate-limited (attempt ${attempt + 1}/${retries}), retrying in ${delayMs}ms`,
        );
        await sleep(delayMs);
      } else {
        throw err;
      }
    }
  }
};

const embedBatchWithRetry = async (texts, retries = MAX_RETRIES) => {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const genAI = getNextGenAI();
      const model = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
      const result = await model.batchEmbedContents({
        requests: texts.map((text) => ({
          content: { parts: [{ text }] },
          outputDimensionality: 768,
        })),
      });
      return result.embeddings.map((e) => e.values);
    } catch (err) {
      const isLastAttempt = attempt === retries - 1;
      if (err.status === 429 && !isLastAttempt) {
        const delayMs = getRetryDelayMs(err);
        console.warn(
          `Embedding batch rate-limited (attempt ${attempt + 1}/${retries}), retrying in ${delayMs}ms`,
        );
        await sleep(delayMs);
      } else {
        throw err;
      }
    }
  }
};

const embedChunksForDocument = async (documentId) => {
  const chunks = await Chunk.find({ documentId });

  if (chunks.length === 0) return 0;

  let embedded = 0;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);

    try {
      const embeddings = await embedBatchWithRetry(batch.map((c) => c.content));
      await Promise.all(
        batch.map((chunk, idx) =>
          Chunk.updateOne({ _id: chunk._id }, { $set: { embedding: embeddings[idx] } }),
        ),
      );
      embedded += batch.length;
    } catch (err) {
      console.error("Embedding batch failed, falling back per chunk:", err.message);
      for (const chunk of batch) {
        try {
          const embedding = await embedTextWithRetry(chunk.content);
          await Chunk.updateOne({ _id: chunk._id }, { $set: { embedding } });
          embedded += 1;
        } catch (e) {
          console.error("Embedding failed:", e.message);
        }
      }
    }
  }

  if (embedded === 0) {
    throw new Error("Embedding failed for all chunks");
  }

  return embedded;
};

module.exports = { embedText, embedChunksForDocument };
