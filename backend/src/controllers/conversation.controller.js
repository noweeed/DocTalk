const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const Document = require("../models/Document");
const Chunk = require("../models/Chunk");
const { embedText } = require("../services/embedding.service");
const { searchChunks } = require("../services/retrieval.service");
const { streamAnswer, streamSummarization, NO_CONTEXT_ANSWER } = require("../services/llm.service");

const SUMMARIZATION_MAX_CHARS = 12000;

function isSummarizationIntent(question) {
  return /\b(summar(y|ize|ise)|overview|tl;?dr|main points|key points|what is this (document|pdf) about)\b/i.test(question);
}

const createConversation = async (req, res) => {
  try {
    const { documentId } = req.body;

    if (!documentId) {
      return res
        .status(400)
        .json({ message: "documentId is required" });
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
    res.status(500).json({ message: error.message });
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
    res.status(500).json({ message: error.message });
  }
};

const listConversations = async (req, res) => {
  try {
    const conversations = await Conversation.find({
      userId: req.user.id,
    }).sort({ updatedAt: -1 });

    res.json(conversations);
  } catch (error) {
    res.status(500).json({ message: error.message });
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

    // Set SSE headers (shared by both paths)
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
          res.write(`data: ${JSON.stringify({ error: streamError.message })}\n\n`);
          if (!fullAnswer) fullAnswer = "An error occurred while generating the summary.";
        }

        // Page-range citation instead of individual chunk citations
        const pages = chunks.map((c) => c.pageNumber);
        const minPage = Math.min(...pages);
        const maxPage = Math.max(...pages);
        const pageRange = minPage === maxPage ? `${minPage}` : `${minPage}-${maxPage}`;
        matchedChunks = [{ pageNumber: pageRange, note: "full document" }];
      }
    } else {
      // ── NORMAL RETRIEVAL PATH ─────────────────────────────
      const questionEmbedding = await embedText(question);
      const results = await searchChunks(documentId, questionEmbedding);

      citations = results.map((chunk) => ({
        pageNumber: chunk.pageNumber,
        chunkIndex: chunk.chunkIndex,
        score: chunk.score,
      }));
      matchedChunks = results;

      try {
        const stream = streamAnswer(question, results);

        for await (const textChunk of stream) {
          fullAnswer += textChunk;
          res.write(`data: ${JSON.stringify({ content: textChunk })}\n\n`);
        }
      } catch (streamError) {
        res.write(`data: ${JSON.stringify({ error: streamError.message })}\n\n`);
        if (!fullAnswer) fullAnswer = "An error occurred while generating the answer.";
      }
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
      return res.status(500).json({ message: error.message });
    }
    // If headers are already sent (mid-stream), send error event and close
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
};

module.exports = {
  createConversation,
  getConversation,
  listConversations,
  sendMessage,
};
