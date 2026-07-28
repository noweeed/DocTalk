const express = require("express");
const passport = require("passport");
const rateLimit = require("express-rate-limit");
const {
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
} = require("../controllers/auth.controller");
const auth = require("../middleware/auth.middleware");
const upload = require("../middleware/upload.middleware");

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === "test" ? 10000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many attempts, please try again later." },
});

router.post("/signup", authLimiter, signup);
router.post("/login", authLimiter, login);
router.post("/logout", auth, logout);
router.get("/me", auth, me);
router.patch("/me", auth, updateMe);
router.post("/avatar", auth, upload.image.single("avatar"), uploadAvatar);
router.post("/password/request", auth, authLimiter, requestPasswordChange);
router.post("/password/confirm", authLimiter, confirmPasswordChange);
router.post("/forgot-password", authLimiter, forgotPassword);
router.post("/reset-password", authLimiter, resetPassword);

router.get(
  "/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
    session: false,
  })
);

router.get(
  "/google/callback",
  passport.authenticate("google", {
    session: false,
    failureRedirect: "/api/auth/google/failure",
  }),
  googleCallback
);

router.get("/google/failure", (req, res) => {
  res.status(401).json({ message: "Google authentication failed" });
});

module.exports = router;
