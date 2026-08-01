const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const dotenv = require("dotenv");
const passport = require("passport");
const rateLimit = require("express-rate-limit");

dotenv.config();

const connectDB = require("./config/db");
const configurePassport = require("./config/passport");
const authRoutes = require("./routes/auth.routes");
const documentRoutes = require("./routes/document.routes");
const conversationRoutes = require("./routes/conversation.routes");
const healthRoutes = require("./routes/health.routes");
const billingRoutes = require("./routes/billing.routes");
const { handleWebhook } = require("./controllers/billing.controller");
const errorHandler = require("./middleware/error.middleware");

const app = express();

// Trust exactly one upstream reverse proxy / load balancer hop so req.ip
// reflects the real client address instead of the proxy's, keeping the
// IP-based rate limiters effective behind a single proxy.
app.set("trust proxy", 1);

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
  }),
);

// Baseline security headers. This API only returns JSON/SSE/PDF streams (no
// HTML pages), so a strict `default-src 'none'` is sufficient; `connect-src
// 'self'` covers the API's own fetch/SSE usage. helmet's other defaults
// (X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security, ...)
// remain enabled and are not disabled here.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        connectSrc: ["'self'"],
      },
    },
  }),
);

app.post(
  "/api/billing/webhook",
  express.raw({ type: "application/json" }),
  handleWebhook,
);

app.use(express.json());
app.use(passport.initialize());

configurePassport();

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === "test" ? 10000 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests, please try again later." },
});

app.use("/api", generalLimiter);

app.use("/health", healthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/conversations", conversationRoutes);
app.use("/api/billing", billingRoutes);

app.use(errorHandler);

const PORT = process.env.PORT || 3001;

const start = async () => {
  try {
    await connectDB();
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
};

if (require.main === module) {
  start();
}

module.exports = app;
