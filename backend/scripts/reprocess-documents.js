const dotenv = require("dotenv");

dotenv.config();

const mongoose = require("mongoose");
const connectDB = require("../src/config/db");
const getGridFSBucket = require("../src/config/gridfs");
const Document = require("../src/models/Document");
const Chunk = require("../src/models/Chunk");
const { extractPageTexts, chunkPages } = require("../src/services/chunking.service");
const { embedChunksForDocument } = require("../src/services/embedding.service");

const downloadFromGridFS = (bucket, fileId) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    const stream = bucket.openDownloadStream(fileId);
    stream.on("data", (c) => chunks.push(c));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });

const reprocessDocument = async (document) => {
  const bucket = getGridFSBucket();

  const buffer = await downloadFromGridFS(bucket, document.gridfsFileId);

  const { numpages, pageTexts } = await extractPageTexts(buffer);
  const allChunks = chunkPages(pageTexts).map((chunk) => ({
    documentId: document._id,
    ...chunk,
  }));

  if (allChunks.length === 0) {
    throw new Error("No text chunks extracted from PDF");
  }

  await Chunk.deleteMany({ documentId: document._id });
  await Chunk.insertMany(allChunks);

  document.pageCount = numpages;
  await document.save();

  await embedChunksForDocument(document._id);

  return { pageCount: numpages, chunkCount: allChunks.length };
};

const run = async () => {
  await connectDB();

  const documents = await Document.find({
    gridfsFileId: { $exists: true, $ne: null },
  });

  console.log(`Found ${documents.length} documents to reprocess\n`);

  let ok = 0;
  let failed = 0;

  for (const document of documents) {
    try {
      const result = await reprocessDocument(document);
      console.log(`OK    ${document.title} -> pages ${result.pageCount}, chunks ${result.chunkCount}`);
      ok += 1;
    } catch (error) {
      failed += 1;
      document.status = "failed";
      await document.save();
      console.error(`FAIL  ${document.title}: ${error.message}`);
    }
  }

  console.log(`\nDone. ${ok} succeeded, ${failed} failed.`);
  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
