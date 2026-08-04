const { getNextGenAI } = require("../config/gemini");
const Chunk = require("../models/Chunk");

const BATCH_SIZE = 4;
const BATCH_DELAY_MS = 4000;
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

const embedChunksForDocument = async (documentId) => {
  const chunks = await Chunk.find({ documentId });

  if (chunks.length === 0) return 0;

  let embedded = 0;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(async (chunk) => {
        const embedding = await embedTextWithRetry(chunk.content);
        await Chunk.updateOne({ _id: chunk._id }, { $set: { embedding } });
        return chunk._id;
      }),
    );

    results.forEach((r) => {
      if (r.status === "rejected") console.error("Embedding failed:", r.reason);
    });

    embedded += results.filter((r) => r.status === "fulfilled").length;

    if (i + BATCH_SIZE < chunks.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  if (embedded === 0) {
    throw new Error("Embedding failed for all chunks");
  }

  return embedded;
};

module.exports = { embedText, embedChunksForDocument };
