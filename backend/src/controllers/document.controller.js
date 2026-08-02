const Document = require("../models/Document");
const Chunk = require("../models/Chunk");
const { extractPageTexts, chunkPages } = require("../services/chunking.service");
const { embedChunksForDocument } = require("../services/embedding.service");
const { isPdfBuffer } = require("../services/fileValidation");
const getGridFSBucket = require("../config/gridfs");

// L2: Build a safe Content-Disposition header from a client-supplied filename.
// The ASCII `filename=` fallback strips anything that could break the
// quoted-string form; `filename*=UTF-8''...` (RFC 5987) carries the real name
// percent-encoded so browsers render it correctly.
const buildContentDisposition = (title) => {
  const asciiFallback =
    String(title || "")
      .replace(/[^\x20-\x7E]/g, "_")
      .replace(/["\\]/g, "_")
      .replace(/[\r\n]/g, "")
      .trim() || "download.pdf";
  const encoded = encodeURIComponent(String(title || "")).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `inline; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
};

const uploadDocument = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  if (!isPdfBuffer(req.file.buffer)) {
    return res.status(400).json({ message: "Invalid PDF file" });
  }

  const document = await Document.create({
    userId: req.user.id,
    title: req.file.originalname,
    status: "processing",
  });

  try {
    // Stream raw PDF to GridFS
    const bucket = getGridFSBucket();
    const uploadStream = bucket.openUploadStream(req.file.originalname, {
      contentType: "application/pdf",
    });

    await new Promise((resolve, reject) => {
      uploadStream.on("error", reject);
      uploadStream.on("finish", resolve);
      uploadStream.end(req.file.buffer);
    });

    document.gridfsFileId = uploadStream.id;

    const { numpages, pageTexts } = await extractPageTexts(req.file.buffer);
    const allChunks = chunkPages(pageTexts).map((chunk) => ({
      documentId: document._id,
      ...chunk,
    }));

    if (allChunks.length > 0) {
      await Chunk.insertMany(allChunks);
    }

    document.pageCount = numpages;
    await document.save();

    await embedChunksForDocument(document._id);

    document.status = "ready";
    await document.save();

    res.status(201).json({
      documentId: document._id,
      title: document.title,
      chunkCount: allChunks.length,
      status: document.status,
    });
  } catch (error) {
    document.status = "failed";
    await document.save();

    console.error("[document.controller]", error);
    res.status(500).json({ message: "Something went wrong" });
  }
};

const getDocumentFile = async (req, res) => {
  try {
    const document = await Document.findOne({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!document) {
      return res.status(404).json({ message: "Document not found" });
    }

    if (!document.gridfsFileId) {
      return res.status(404).json({ message: "File not available" });
    }

    const bucket = getGridFSBucket();
    const downloadStream = bucket.openDownloadStream(document.gridfsFileId);

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": buildContentDisposition(document.title),
    });

    downloadStream.on("error", () => {
      res.status(404).json({ message: "File not found" });
    });

    downloadStream.pipe(res);
  } catch (error) {
    console.error("[document.controller]", error);
    res.status(500).json({ message: "Something went wrong" });
  }
};

const listDocuments = async (req, res) => {
  try {
    const { filter } = req.query;
    const query = { userId: req.user.id };
    let sort = { createdAt: -1 };

    if (filter === "recent") {
      query.isTrashed = false;
      sort = { lastOpenedAt: -1 };
    } else if (filter === "starred") {
      query.isStarred = true;
      query.isTrashed = false;
    } else if (filter === "trash") {
      query.isTrashed = true;
    } else {
      query.isTrashed = false;
    }

    let queryBuilder = Document.find(query).sort(sort);

    if (filter === "recent") {
      queryBuilder = queryBuilder.limit(20);
    }

    const documents = await queryBuilder;

    res.status(200).json(documents);
  } catch (error) {
    console.error("[document.controller]", error);
    res.status(500).json({ message: "Something went wrong" });
  }
};

const getDocument = async (req, res) => {
  try {
    const document = await Document.findOne({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!document) {
      return res.status(404).json({ message: "Document not found" });
    }

    document.lastOpenedAt = new Date();
    await document.save();

    res.status(200).json(document);
  } catch (error) {
    console.error("[document.controller]", error);
    res.status(500).json({ message: "Something went wrong" });
  }
};

const updateDocument = async (req, res) => {
  try {
    const { title, isStarred } = req.body;
    const updates = {};

    if (title !== undefined) updates.title = title;
    if (isStarred !== undefined) updates.isStarred = isStarred;

    const document = await Document.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { $set: updates },
      { returnDocument: "after" }
    );

    if (!document) {
      return res.status(404).json({ message: "Document not found" });
    }

    res.status(200).json(document);
  } catch (error) {
    console.error("[document.controller]", error);
    res.status(500).json({ message: "Something went wrong" });
  }
};

const trashDocument = async (req, res) => {
  try {
    const document = await Document.findOne({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!document) {
      return res.status(404).json({ message: "Document not found" });
    }

    document.isTrashed = true;
    document.trashedAt = new Date();
    await document.save();

    res.status(200).json({ message: "Document moved to trash" });
  } catch (error) {
    console.error("[document.controller]", error);
    res.status(500).json({ message: "Something went wrong" });
  }
};

const restoreDocument = async (req, res) => {
  try {
    const document = await Document.findOne({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!document) {
      return res.status(404).json({ message: "Document not found" });
    }

    document.isTrashed = false;
    document.trashedAt = null;
    await document.save();

    res.status(200).json(document);
  } catch (error) {
    console.error("[document.controller]", error);
    res.status(500).json({ message: "Something went wrong" });
  }
};

const permanentDeleteDocument = async (req, res) => {
  try {
    const document = await Document.findOne({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!document) {
      return res.status(404).json({ message: "Document not found" });
    }

    await Chunk.deleteMany({ documentId: document._id });

    if (document.gridfsFileId) {
      try {
        const bucket = getGridFSBucket();
        await bucket.delete(document.gridfsFileId);
      } catch (err) {
        console.error("GridFS cleanup failed:", err.message);
      }
    }

    await Document.deleteOne({ _id: document._id });

    res.status(200).json({ message: "Document permanently deleted" });
  } catch (error) {
    console.error("[document.controller]", error);
    res.status(500).json({ message: "Something went wrong" });
  }
};

module.exports = {
  uploadDocument,
  getDocumentFile,
  listDocuments,
  getDocument,
  updateDocument,
  trashDocument,
  restoreDocument,
  permanentDeleteDocument,
};
