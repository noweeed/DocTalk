const { getNextGenAI, keyCount } = require("../config/gemini");
const Chunk = require("../models/Chunk");

const EMBEDDING_MODEL =
  (process.env.GEMINI_EMBEDDING_MODEL || "").trim() || "gemini-embedding-001";
const EMBEDDING_DIMENSIONS = 768;
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

const isAuthError = (err) => err?.status === 401 || err?.status === 403;

const runWithRetry = async (fn, label) => {
  const maxAttempts = Math.max(MAX_RETRIES, keyCount || 1);
  let authFailures = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isLastAttempt = attempt === maxAttempts - 1;
      if (err.status === 429 && !isLastAttempt) {
        const delayMs = getRetryDelayMs(err);
        console.warn(
          `${label} rate-limited (attempt ${attempt + 1}/${maxAttempts}), retrying in ${delayMs}ms`,
        );
        await sleep(delayMs);
      } else if (isAuthError(err) && keyCount > 1 && authFailures < keyCount - 1) {
        authFailures += 1;
        console.warn(
          `${label} auth error (${err.status}) on key ${authFailures}/${keyCount}, trying next key`,
        );
      } else {
        throw err;
      }
    }
  }
};

const embedText = async (text) => {
  const genAI = getNextGenAI();
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
  const result = await model.embedContent({
    content: { parts: [{ text }] },
    outputDimensionality: EMBEDDING_DIMENSIONS,
  });
  return result.embedding.values;
};

const embedTextWithRetry = async (text) =>
  runWithRetry(() => embedText(text), "Embedding");

const embedBatchWithRetry = async (texts) =>
  runWithRetry(async () => {
    const genAI = getNextGenAI();
    const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
    const result = await model.batchEmbedContents({
      requests: texts.map((text) => ({
        content: { parts: [{ text }] },
        outputDimensionality: EMBEDDING_DIMENSIONS,
      })),
    });
    return result.embeddings.map((e) => e.values);
  }, "Embedding batch");

const embedChunksForDocument = async (documentId) => {
  const chunks = await Chunk.find({ documentId });

  if (chunks.length === 0) return 0;

  let embedded = 0;
  let lastError = null;

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
      lastError = err;
      console.error(
        "[embedding.service] Embedding batch failed, falling back per chunk:",
        err.message,
      );
      for (const chunk of batch) {
        try {
          const embedding = await embedTextWithRetry(chunk.content);
          await Chunk.updateOne({ _id: chunk._id }, { $set: { embedding } });
          embedded += 1;
        } catch (e) {
          lastError = e;
          console.error(
            `[embedding.service] Embedding failed for chunk ${chunk._id}:`,
            e.message,
          );
        }
      }
    }
  }

  if (embedded === 0) {
    throw new Error(
      `Embedding failed for all chunks: ${lastError?.message || "unknown error"}`,
      { cause: lastError },
    );
  }

  if (embedded < chunks.length) {
    throw new Error(
      `Embedding failed for ${chunks.length - embedded} of ${chunks.length} chunks: ${lastError?.message || "unknown error"}`,
      { cause: lastError },
    );
  }

  return embedded;
};

module.exports = { embedText, embedChunksForDocument };
