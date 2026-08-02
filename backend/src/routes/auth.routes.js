const express = require("express");
const passport = require("passport");
const crypto = require("crypto");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const {
  signup,
  login,
  logout,
  googleCallback,
  exchangeOAuthCode,
  me,
  updateMe,
  requestPasswordChange,
  confirmPasswordChange,
  forgotPassword,
  resetPassword,
  uploadAvatar,
  deleteAccount,
} = require("../controllers/auth.controller");
const auth = require("../middleware/auth.middleware");
const upload = require("../middleware/upload.middleware");

const router = express.Router();

const OAUTH_STATE_TTL_MS = 5 * 60 * 1000;

const getCookie = (req, name) => {
  const header = req.headers.cookie || "";
  const match = header.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
};

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === "test" ? 10000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many attempts, please try again later." },
  // Pre-auth routes have no logged-in user, so key on the real client IP
  // (accurate thanks to "trust proxy") plus the attempted email. This keeps
  // shared-IP users from being blocked because one bad actor targets a
  // different account from the same address.
  keyGenerator: (req) => {
    const ipKey = ipKeyGenerator(req.ip);
    const email =
      typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    return `${ipKey}-${email || "no-email"}`;
  },
});

// Token-based endpoints (OAuth exchange codes, password reset/change tokens)
// authenticate via a random single-use secret rather than a guessable
// credential, and their request bodies carry no email. Keying them with
// authLimiter's IP+email fallback would collapse all of them into the same
// "<ip>-no-email" bucket, so unrelated auth actions from one IP would drain
// each other's allowance. Give them a separate, more lenient, IP-only limiter.
const createIpOnlyAuthLimiter = () =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: process.env.NODE_ENV === "test" ? 10000 : 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many attempts, please try again later." },
    keyGenerator: (req) => ipKeyGenerator(req.ip),
  });

const oauthExchangeLimiter = createIpOnlyAuthLimiter();
const passwordTokenLimiter = createIpOnlyAuthLimiter();

router.post("/signup", authLimiter, signup);
router.post("/login", authLimiter, login);
router.post("/logout", auth, logout);
router.get("/me", auth, me);
router.patch("/me", auth, updateMe);
router.post("/avatar", auth, upload.image.single("avatar"), uploadAvatar);
router.delete("/me", auth, deleteAccount);
router.post("/password/request", auth, passwordTokenLimiter, requestPasswordChange);
router.post("/password/confirm", passwordTokenLimiter, confirmPasswordChange);
router.post("/forgot-password", authLimiter, forgotPassword);
router.post("/reset-password", passwordTokenLimiter, resetPassword);
router.post("/oauth/exchange", oauthExchangeLimiter, exchangeOAuthCode);

router.get("/google", (req, res, next) => {
  const state = crypto.randomUUID();

  res.cookie("oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: OAUTH_STATE_TTL_MS,
    path: "/api/auth/google",
  });

  passport.authenticate("google", {
    scope: ["profile", "email"],
    state,
    session: false,
  })(req, res, next);
});

router.get(
  "/google/callback",
  (req, res, next) => {
    const cookieState = getCookie(req, "oauth_state");
    res.clearCookie("oauth_state", { path: "/api/auth/google" });

    if (!cookieState || !req.query.state || cookieState !== req.query.state) {
      console.warn("[oauth] state mismatch", {
        cookieState,
        queryState: req.query.state,
        hasCookieHeader: Boolean(req.headers.cookie),
      });
      return res.status(401).json({ message: "Google authentication failed" });
    }

    passport.authenticate("google", {
      session: false,
      failureRedirect: "/api/auth/google/failure",
    })(req, res, next);
  },
  googleCallback
);

router.get("/google/failure", (req, res) => {
  console.warn("[oauth] passport authenticate failure", { query: req.query });
  res.status(401).json({ message: "Google authentication failed" });
});

// Expose the limiters so tests can assert bucket separation without issuing the
// thousands of requests needed to hit the relaxed test-mode limits.
router.authLimiter = authLimiter;
router.oauthExchangeLimiter = oauthExchangeLimiter;
router.passwordTokenLimiter = passwordTokenLimiter;

module.exports = router;
