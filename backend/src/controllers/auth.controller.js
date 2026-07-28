const crypto = require("crypto");
const User = require("../models/User");
const Document = require("../models/Document");
const TokenBlocklist = require("../models/TokenBlocklist");
const {
  hashPassword,
  comparePassword,
  generateToken,
} = require("../services/auth.service");
const { sendPasswordResetEmail, sendPasswordChangeConfirmation } = require("../services/email.service");
const getGridFSBucket = require("../config/gridfs");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

const signup = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ message: "Invalid email format" });
    }

    if (!PASSWORD_REGEX.test(password)) {
      return res.status(400).json({
        message:
          "Password must be at least 8 characters and include an uppercase letter, a lowercase letter, and a number.",
      });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ message: "Email already in use" });
    }

    const passwordHash = await hashPassword(password);
    const user = await User.create({ name, email, passwordHash });

    const token = generateToken(user._id);

    res.status(201).json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        plan: user.plan,
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const user = await User.findOne({ email });
    if (!user || !user.passwordHash) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const isMatch = await comparePassword(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = generateToken(user._id);

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        plan: user.plan,
        avatarUrl: user.avatarUrl,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const logout = async (req, res) => {
  try {
    const { jti, exp } = req.user;
    const expiresAt = new Date(exp * 1000);

    await TokenBlocklist.create({ jti, expiresAt });

    res.json({ message: "Logged out successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const googleCallback = async (req, res) => {
  try {
    const token = generateToken(req.user._id);

    res.redirect(`${process.env.FRONTEND_URL}/oauth/callback?token=${token}`);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const me = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-passwordHash");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const docCount = await Document.countDocuments({
      userId: req.user.id,
      isTrashed: false,
    });

    const userDocs = await Document.find({ userId: req.user.id }).select("gridfsFileId");
    const fileIds = userDocs.filter((d) => d.gridfsFileId).map((d) => d.gridfsFileId);
    let storageUsedBytes = 0;
    if (fileIds.length > 0) {
      try {
        const bucket = getGridFSBucket();
        const files = await bucket.find({ _id: { $in: fileIds } }).toArray();
        storageUsedBytes = files.reduce((sum, f) => sum + (f.length || 0), 0);
      } catch (gridfsErr) {
        console.error("[me] GridFS query failed:", gridfsErr.message);
      }
    }

    res.json({
      id: user._id,
      name: user.name,
      email: user.email,
      plan: user.plan,
      avatarUrl: user.avatarUrl,
      documentsCount: docCount,
      storageUsedBytes,
      questionsUsedThisMonth: user.questionsUsedThisMonth,
      usageResetAt: user.usageResetAt,
      createdAt: user.createdAt,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const updateMe = async (req, res) => {
  try {
    const { name } = req.body;
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (name !== undefined) {
      if (name.trim().length < 2) {
        return res.status(400).json({ message: "Name must be at least 2 characters" });
      }
      user.name = name.trim();
    }

    await user.save();

    const userDocs = await Document.find({ userId: req.user.id }).select("gridfsFileId");
    const fileIds = userDocs.filter((d) => d.gridfsFileId).map((d) => d.gridfsFileId);
    let storageUsedBytes = 0;
    if (fileIds.length > 0) {
      try {
        const bucket = getGridFSBucket();
        const files = await bucket.find({ _id: { $in: fileIds } }).toArray();
        storageUsedBytes = files.reduce((sum, f) => sum + (f.length || 0), 0);
      } catch (gridfsErr) {
        console.error("[me] GridFS query failed:", gridfsErr.message);
      }
    }

    res.json({
      id: user._id,
      name: user.name,
      email: user.email,
      plan: user.plan,
      avatarUrl: user.avatarUrl,
      documentsCount: await Document.countDocuments({ userId: req.user.id, isTrashed: false }),
      storageUsedBytes,
      questionsUsedThisMonth: user.questionsUsedThisMonth,
      usageResetAt: user.usageResetAt,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const requestPasswordChange = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!user.passwordHash) {
      return res.status(400).json({ message: "Cannot change password for Google-authenticated accounts" });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiry = new Date(Date.now() + 60 * 60 * 1000);

    const confirmLink = `${process.env.FRONTEND_URL}/change-password?token=${token}`;

    await sendPasswordChangeConfirmation(user.email, confirmLink);

    user.passwordChangeToken = token;
    user.passwordChangeTokenExpiry = expiry;
    await user.save();

    res.json({ message: "Check your email for a link to continue changing your password." });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const confirmPasswordChange = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ message: "Token and new password are required" });
    }

    const user = await User.findOne({
      passwordChangeToken: token,
      passwordChangeTokenExpiry: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired token" });
    }

    if (!PASSWORD_REGEX.test(newPassword)) {
      return res.status(400).json({
        message:
          "Password must be at least 8 characters and include an uppercase letter, a lowercase letter, and a number.",
      });
    }

    user.passwordHash = await hashPassword(newPassword);
    user.passwordChangeToken = null;
    user.passwordChangeTokenExpiry = null;
    await user.save();

    res.json({ message: "Password changed successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !user.passwordHash) {
      return res.json({ message: "If the email exists, a reset link has been sent" });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiry = new Date(Date.now() + 60 * 60 * 1000);

    const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;

    await sendPasswordResetEmail(user.email, resetLink);

    user.resetPasswordToken = token;
    user.resetPasswordTokenExpiry = expiry;
    await user.save();

    res.json({ message: "If the email exists, a reset link has been sent" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ message: "Token and new password are required" });
    }

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordTokenExpiry: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired reset token" });
    }

    if (!PASSWORD_REGEX.test(newPassword)) {
      return res.status(400).json({
        message:
          "Password must be at least 8 characters and include an uppercase letter, a lowercase letter, and a number.",
      });
    }

    user.passwordHash = await hashPassword(newPassword);
    user.resetPasswordToken = null;
    user.resetPasswordTokenExpiry = null;
    await user.save();

    res.json({ message: "Password reset successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const uploadAvatar = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const avatarBase64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { avatarUrl: avatarBase64 },
      { new: true }
    ).select("-passwordHash");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ avatarUrl: user.avatarUrl });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  signup,
  login,
  logout,
  googleCallback,
  me,
  updateMe,
  requestPasswordChange,
  confirmPasswordChange,
  forgotPassword,
  resetPassword,
  uploadAvatar,
};
