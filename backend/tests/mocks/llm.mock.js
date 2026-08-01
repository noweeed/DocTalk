const FAKE_ANSWER = "This is a test answer based on the provided context.";

const SMALL_TALK_PHRASES = [
  "hi", "hi there", "hello", "hello there", "hey", "yo", "sup", "hola",
  "thanks", "thank you", "thankyou", "ty", "ok", "okay", "k", "bye", "goodbye",
  "good morning", "good afternoon", "good evening", "how are you", "what's up", "whats up",
  "nice to meet you", "you're welcome", "you are welcome",
  "good boy", "good girl", "good job", "well done", "nice one", "well said",
  "thanks a lot", "thank you so much", "thanks so much",
  "love it", "love you", "nice", "great", "great work", "awesome", "cool", "perfect",
  "wow", "interesting", "amazing", "super", "good", "yes", "yep", "yeah", "no", "nope",
  "correct", "right", "sure", "alright", "all right", "lol", "haha", "exactly",
];

const mockClassifyMessage = jest.fn(async (question) => {
  const text = question.trim().toLowerCase().replace(/[!?.,]+$/g, "");
  return SMALL_TALK_PHRASES.includes(text) ? "SMALL_TALK" : "QUESTION";
});

const mockStreamAnswer = jest.fn(async function* (question, matchedChunks) {
  if (!matchedChunks || matchedChunks.length === 0) {
    yield "I don't have relevant information in this document to answer that.";
    return;
  }
  const words = FAKE_ANSWER.split(" ");
  for (const word of words) {
    yield word + " ";
  }
});

const mockStreamSummarization = jest.fn(async function* (question, context) {
  const words = FAKE_ANSWER.split(" ");
  for (const word of words) {
    yield word + " ";
  }
});

const mockStreamSmallTalk = jest.fn(async function* (question) {
  const words = "Hello! What would you like to know?".split(" ");
  for (const word of words) {
    yield word + " ";
  }
});

module.exports = {
  classifyMessage: mockClassifyMessage,
  streamAnswer: mockStreamAnswer,
  streamSummarization: mockStreamSummarization,
  streamSmallTalk: mockStreamSmallTalk,
  NO_CONTEXT_ANSWER:
    "I don't have relevant information in this document to answer that.",
};
