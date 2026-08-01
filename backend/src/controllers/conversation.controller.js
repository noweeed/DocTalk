const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const Document = require("../models/Document");
const Chunk = require("../models/Chunk");
const { embedText } = require("../services/embedding.service");
const { searchChunks } = require("../services/retrieval.service");
const {
  classifyMessage,
  streamAnswer,
  streamSummarization,
  streamSmallTalk,
  NO_CONTEXT_ANSWER,
} = require("../services/llm.service");

const SUMMARIZATION_MAX_CHARS = 12000;

const isNoInfoAnswer = (answer) => {
  const text = answer.toLowerCase();
  return (
    text.includes("don't have enough information") ||
    text.includes("do not have enough information") ||
    text.includes("don't have the information") ||
    text.includes("do not have the information") ||
    text.includes("no relevant information") ||
    text.includes("not enough information") ||
    text.includes("cannot answer") ||
    text.includes("can't answer") ||
    text.includes("i don't have information")
  );
};

function isSummarizationIntent(question) {
  return /\b(summar(y|ize|ise)|overview|tl;?dr|main points|key points|what is this (document|pdf) about)\b/i.test(question);
}

function isObviousSmallTalk(message) {
  const trimmed = message.trim();
  const wordCount = trimmed.split(/\s+/).length;
  return trimmed.length < 15 && !trimmed.includes("?") && wordCount <= 4;
}

const dedupeByPage = (items) => {
  const byPage = new Map();
  for (const item of items) {
    const existing = byPage.get(item.pageNumber);
    if (!existing || item.score > existing.score) {
      byPage.set(item.pageNumber, item);
    }
  }
  return Array.from(byPage.values()).sort((a, b) => a.pageNumber - b.pageNumber);
};

const createConversation = async (req, res) => {
  try {
    const { documentId } = req.body;

    if (!documentId) {
      return res
        .status(400)
        .json({ message: "documentId is required" });
    }

    if (typeof documentId !== "string" || !mongoose.Types.ObjectId.isValid(documentId)) {
      return res.status(400).json({ message: "Invalid documentId" });
    }

    const document = await Document.findOne({
      _id: documentId,
      userId: req.user.id,
    });

    if (!document) {
      return res.status(404).json({ message: "Document not found" });
    }

    const conversation = await Conversation.create({
      userId: req.user.id,
      documentIds: [documentId],
    });

    res.status(201).json({
      _id: conversation._id,
      userId: conversation.userId,
      documentIds: conversation.documentIds,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    });
  } catch (error) {
    console.error("[conversation.controller]", error);
    res.status(500).json({ message: "Something went wrong" });
  }
};

const getConversation = async (req, res) => {
  try {
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    const messages = await Message.find({
      conversationId: conversation._id,
    }).sort({ createdAt: 1 });

    res.json({ conversation, messages });
  } catch (error) {
    console.error("[conversation.controller]", error);
    res.status(500).json({ message: "Something went wrong" });
  }
};

const listConversations = async (req, res) => {
  try {
    const conversations = await Conversation.find({
      userId: req.user.id,
    }).sort({ updatedAt: -1 });

    res.json(conversations);
  } catch (error) {
    console.error("[conversation.controller]", error);
    res.status(500).json({ message: "Something went wrong" });
  }
};

const sendMessage = async (req, res) => {
  try {
    const { question } = req.body;

    if (!question) {
      return res
        .status(400)
        .json({ message: "question is required" });
    }

    const conversation = await Conversation.findOne({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    const documentId = conversation.documentIds[0];

    await Message.create({
      conversationId: conversation._id,
      role: "user",
      content: question,
    });

    // Route intent without embeddings. Cheap heuristic pre-filter first to skip
    // the classifier round trip for obvious small talk; only call the LLM
    // classifier for ambiguous messages. Only retrieve chunks (embeddings) for
    // real questions. Summarization is detected by regex and skips everything.
    let intent = "QUESTION";
    if (!isSummarizationIntent(question)) {
      if (isObviousSmallTalk(question)) {
        intent = "SMALL_TALK";
      } else {
        try {
          intent = await classifyMessage(question);
        } catch (err) {
          console.error("Intent classification failed:", err.message);
        }
      }
    }

    // Set SSE headers (shared by all paths)
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    let fullAnswer = "";
    let citations = [];
    let matchedChunks = [];

    if (isSummarizationIntent(question)) {
      // ── SUMMARIZATION PATH ──────────────────────────────────
      const chunks = await Chunk.find({ documentId })
        .sort({ pageNumber: 1, chunkIndex: 1 })
        .lean();

      if (chunks.length === 0) {
        res.write(`data: ${JSON.stringify({ content: NO_CONTEXT_ANSWER })}\n\n`);
        fullAnswer = NO_CONTEXT_ANSWER;
      } else {
        // Concatenate content with character budget
        const totalChars = chunks.reduce((s, c) => s + c.content.length, 0);
        let context;

        if (totalChars <= SUMMARIZATION_MAX_CHARS) {
          context = chunks.map((c) => c.content).join("\n\n");
        } else {
          const ratio = SUMMARIZATION_MAX_CHARS / totalChars;
          const targetChunks = Math.max(1, Math.floor(chunks.length * ratio));
          const step = Math.max(1, Math.floor(chunks.length / targetChunks));
          const sampled = chunks.filter((_, i) => i % step === 0);
          context = sampled.map((c) => c.content).join("\n\n");
        }

        try {
          const stream = streamSummarization(question, context);

          for await (const textChunk of stream) {
            fullAnswer += textChunk;
            res.write(`data: ${JSON.stringify({ content: textChunk })}\n\n`);
          }
        } catch (streamError) {
          res.write(`data: ${JSON.stringify({ error: "Something went wrong" })}\n\n`);
          if (!fullAnswer) fullAnswer = "An error occurred while generating the summary.";
        }

        // Page-range citation instead of individual chunk citations
        const pages = chunks.map((c) => c.pageNumber);
        const minPage = Math.min(...pages);
        const maxPage = Math.max(...pages);
        const pageRange = minPage === maxPage ? `${minPage}` : `${minPage}-${maxPage}`;
        matchedChunks = [{ pageNumber: pageRange, note: "full document" }];
      }
    } else if (intent === "SMALL_TALK") {
      // ── SMALL TALK PATH ───────────────────────────────────
      // No retrieval, no citations. The LLM answers warmly with no document context.
      try {
        const stream = streamSmallTalk(question);

        for await (const textChunk of stream) {
          fullAnswer += textChunk;
          res.write(`data: ${JSON.stringify({ content: textChunk })}\n\n`);
        }
      } catch (streamError) {
        res.write(`data: ${JSON.stringify({ error: "Something went wrong" })}\n\n`);
        if (!fullAnswer) fullAnswer = "An error occurred while generating the answer.";
      }
    } else {
      // ── NORMAL RETRIEVAL PATH ─────────────────────────────
      const questionEmbedding = await embedText(question);
      const results = await searchChunks(documentId, questionEmbedding);

      matchedChunks = dedupeByPage(results);
      citations = matchedChunks.map((chunk) => ({
        pageNumber: chunk.pageNumber,
        chunkIndex: chunk.chunkIndex,
        score: chunk.score,
      }));

      try {
        const stream = streamAnswer(question, results);

        for await (const textChunk of stream) {
          fullAnswer += textChunk;
          res.write(`data: ${JSON.stringify({ content: textChunk })}\n\n`);
        }
      } catch (streamError) {
        res.write(`data: ${JSON.stringify({ error: "Something went wrong" })}\n\n`);
        if (!fullAnswer) fullAnswer = "An error occurred while generating the answer.";
      }
    }

    // If the model couldn't answer from the retrieved context, don't show citations
    if (isNoInfoAnswer(fullAnswer)) {
      matchedChunks = [];
      citations = [];
    }

    // Save the complete assistant message
    await Message.create({
      conversationId: conversation._id,
      role: "assistant",
      content: fullAnswer,
      citations,
    });

    // Touch updatedAt so Mongoose timestamps stay current
    conversation.updatedAt = new Date();
    await conversation.save();

    // Send completion signal
    res.write(`data: ${JSON.stringify({ done: true, matchedChunks })}\n\n`);
    res.end();
  } catch (error) {
    // If headers haven't been sent yet, fall back to JSON error response
    if (!res.headersSent) {
      console.error("[conversation.controller]", error);
      return res.status(500).json({ message: "Something went wrong" });
    }
    // If headers are already sent (mid-stream), send error event and close
    res.write(`data: ${JSON.stringify({ error: "Something went wrong" })}\n\n`);
    res.end();
  }
};

module.exports = {
  createConversation,
  getConversation,
  listConversations,
  sendMessage,
};
