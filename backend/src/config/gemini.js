const { GoogleGenerativeAI } = require("@google/generative-ai");

const rawKeys = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY1,
  process.env.GEMINI_API_KEY2,
  process.env.GEMINI_API_KEY3,
]
  .map((k) => (typeof k === "string" ? k.trim() : ""))
  .filter(Boolean); // drops any that are missing/unset

const apiKeys = [...new Set(rawKeys)];

if (apiKeys.length === 0) {
  console.warn(
    "No Gemini API keys found (set GEMINI_API_KEY or GEMINI_API_KEY1) — embedding calls will fail",
  );
}

const clients = apiKeys.map((key) => new GoogleGenerativeAI(key));

let cursor = 0;

// Round-robin: each call returns the next client in rotation, wrapping
// around. Spreads embedding requests across each key's own 100/min quota.
const getNextGenAI = () => {
  if (clients.length === 0) {
    throw new Error(
      "No Gemini API key configured. Set GEMINI_API_KEY or GEMINI_API_KEY1.",
    );
  }
  const client = clients[cursor % clients.length];
  cursor++;
  return client;
};

module.exports = { getNextGenAI, keyCount: clients.length };
