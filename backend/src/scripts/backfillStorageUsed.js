const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config();

const connectDB = require("../config/db");
const User = require("../models/User");
const Document = require("../models/Document");
const getGridFSBucket = require("../config/gridfs");

const run = async () => {
  await connectDB();

  const users = await User.find({}).select("_id email");
  let backfilledCount = 0;
  let docLookups = 0;

  for (const user of users) {
    const docs = await Document.find({ userId: user._id, gridfsFileId: { $ne: null } }).select(
      "gridfsFileId fileSizeBytes",
    );

    for (const doc of docs) {
      if (!doc.fileSizeBytes) {
        try {
          const bucket = getGridFSBucket();
          const file = await bucket.find({ _id: doc.gridfsFileId }).next();
          if (file) {
            doc.fileSizeBytes = file.length || 0;
            await doc.save();
            backfilledCount++;
          }
        } catch (err) {
          console.error(`[backfill] failed to look up file ${doc.gridfsFileId}:`, err.message);
        }
        docLookups++;
      }
    }

    const total = docs.reduce((sum, d) => sum + (d.fileSizeBytes || 0), 0);
    await User.findByIdAndUpdate(user._id, { $set: { storageUsedBytes: total } });

    console.log(`Backfilled user ${user._id}: ${docs.length} docs, ${total} bytes`);
  }

  console.log(`Backfill complete: ${users.length} users, ${backfilledCount} docs updated, ${docLookups} GridFS lookups`);

  await mongoose.disconnect();
  process.exit(0);
};

run().catch(async (err) => {
  console.error("[backfill] failed:", err);
  await mongoose.disconnect();
  process.exit(1);
});