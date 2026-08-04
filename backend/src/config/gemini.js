const { GoogleGenerativeAI } = require("@google/generative-ai");

const apiKeys = [
  process.env.GEMINI_API_KEY1,
  process.env.GEMINI_API_KEY2,
  process.env.GEMINI_API_KEY3,
].filter(Boolean); // drops any that are missing/unset

if (apiKeys.length === 0) {
  console.warn("No Gemini API keys found — embedding calls will fail");
}

const clients = apiKeys.map((key) => new GoogleGenerativeAI(key));

let cursor = 0;

// Round-robin: each call returns the next client in rotation, wrapping
// around. Spreads embedding requests across each key's own 100/min quota.
const getNextGenAI = () => {
  const client = clients[cursor % clients.length];
  cursor++;
  return client;
};

module.exports = { getNextGenAI, keyCount: clients.length };
