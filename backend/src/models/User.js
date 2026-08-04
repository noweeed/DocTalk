const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, default: null },
    googleId: { type: String, default: null },
    stripeCustomerId: { type: String, default: null },
    stripeSubscriptionId: { type: String, default: null },
    stripeSubscriptionEndsAt: { type: Date, default: null },
    plan: { type: String, enum: ["free", "pro"], default: "free" },
    planStatus: { type: String, default: "active" },
    questionsUsedThisMonth: { type: Number, default: 0 },
    storageUsedBytes: { type: Number, default: 0 },
    usageResetAt: { type: Date, default: () => new Date() },
    avatarUrl: { type: String, default: null },
    resetPasswordToken: { type: String, default: null },
    resetPasswordTokenExpiry: { type: Date, default: null },
    pendingPasswordHash: { type: String, default: null },
    passwordChangeToken: { type: String, default: null },
    passwordChangeTokenExpiry: { type: Date, default: null },
  },
  { timestamps: true }
);

userSchema.index({ googleId: 1 }, { unique: true, partialFilterExpression: { googleId: { $type: "string" } } });

module.exports = mongoose.model("User", userSchema);
