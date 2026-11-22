const Groq = require("groq-sdk");

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const GROQ_MODEL = (process.env.GROQ_MODEL || "").trim() || "openai/gpt-oss-20b";
const GROQ_CLASSIFIER_MODEL =
  (process.env.GROQ_CLASSIFIER_MODEL || "").trim() || GROQ_MODEL;

module.exports = groq;
module.exports.GROQ_MODEL = GROQ_MODEL;
module.exports.GROQ_CLASSIFIER_MODEL = GROQ_CLASSIFIER_MODEL;
