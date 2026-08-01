const fs = require("fs");
const path = require("path");
const request = require("supertest");
const app = require("../src/server");
const Message = require("../src/models/Message");
const { connect, clearCollections } = require("./setup");

jest.mock("pdf-parse", () => require("./mocks/pdf-parse.mock"));
jest.mock("../src/services/embedding.service", () =>
  require("./mocks/embedding.mock")
);
jest.mock("../src/services/llm.service", () => require("./mocks/llm.mock"));
jest.mock("../src/services/retrieval.service", () =>
  require("./mocks/retrieval.mock")
);

beforeAll(async () => await connect());
afterEach(async () => {
  await clearCollections();
  jest.restoreAllMocks();
});

const samplePdf = fs.readFileSync(path.join(__dirname, "fixtures", "sample.pdf"));

describe("Chat", () => {
  let token;
  let docId;
  let conversationId;

  beforeEach(async () => {
    const signupRes = await request(app)
      .post("/api/auth/signup")
      .send({ name: "Chat User", email: "chat@test.com", password: "Password1" });
    token = signupRes.body.token;

    const uploadRes = await request(app)
      .post("/api/documents")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", samplePdf, {
        filename: "sample.pdf",
        contentType: "application/pdf",
      });
    docId = uploadRes.body.documentId;

    const convRes = await request(app)
      .post("/api/conversations")
      .set("Authorization", `Bearer ${token}`)
      .send({ documentId: docId });
    conversationId = convRes.body._id;
  });

  describe("POST /api/conversations", () => {
    it("creates a conversation with correct shape", async () => {
      const res = await request(app)
        .post("/api/conversations")
        .set("Authorization", `Bearer ${token}`)
        .send({ documentId: docId })
        .expect(201);

      expect(res.body._id).toBeDefined();
      expect(res.body.userId).toBeDefined();
      expect(res.body.documentIds).toContain(docId);
    });

    it("returns 400 without documentId", async () => {
      const res = await request(app)
        .post("/api/conversations")
        .set("Authorization", `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.message).toBe("documentId is required");
    });

    it("rejects a non-string documentId (NoSQL injection guard)", async () => {
      const res = await request(app)
        .post("/api/conversations")
        .set("Authorization", `Bearer ${token}`)
        .send({ documentId: { $ne: null } });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Invalid documentId");
    });

    it("rejects a malformed documentId that is not an ObjectId", async () => {
      const res = await request(app)
        .post("/api/conversations")
        .set("Authorization", `Bearer ${token}`)
        .send({ documentId: "not-an-object-id" });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Invalid documentId");
    });
  });

  describe("GET /api/conversations/:id", () => {
    it("returns conversation with empty messages initially", async () => {
      const res = await request(app)
        .get(`/api/conversations/${conversationId}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body.conversation._id).toBe(conversationId);
      expect(res.body.messages).toHaveLength(0);
    });
  });

  describe("POST /api/conversations/:id/messages", () => {
    it("streams SSE response and saves messages", async () => {
      const msgRes = await request(app)
        .post(`/api/conversations/${conversationId}/messages`)
        .set("Authorization", `Bearer ${token}`)
        .send({ question: "What is mentioned on page one?" })
        .expect(200);

      // Parse SSE events from the response body
      // NOTE: supertest collects the full streaming response as text before returning
      const events = msgRes.text
        .split("\n\n")
        .filter(Boolean)
        .map((event) => JSON.parse(event.replace("data: ", "")));

      const contentEvents = events.filter((e) => e.content !== undefined);
      expect(contentEvents.length).toBeGreaterThan(0);

      const doneEvent = events.find((e) => e.done === true);
      expect(doneEvent).toBeDefined();
      expect(doneEvent.matchedChunks).toBeDefined();

      // Verify messages were saved to the database
      const convRes = await request(app)
        .get(`/api/conversations/${conversationId}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(convRes.body.messages).toHaveLength(2);
      expect(convRes.body.messages[0].role).toBe("user");
      expect(convRes.body.messages[0].content).toBe(
        "What is mentioned on page one?"
      );
      expect(convRes.body.messages[1].role).toBe("assistant");
      expect(convRes.body.messages[1].content).toContain(
        "This is a test answer"
      );
      expect(convRes.body.messages[1].citations).toBeDefined();
      expect(convRes.body.messages[1].citations.length).toBeGreaterThan(0);
    });

    it("dedupes citations by page, keeps highest score, sorts ascending", async () => {
      const { searchChunks } = require("../src/services/retrieval.service");
      searchChunks.mockResolvedValueOnce([
        { content: "alpha", pageNumber: 3, chunkIndex: 0, score: 0.8 },
        { content: "beta", pageNumber: 3, chunkIndex: 1, score: 0.9 },
        { content: "gamma", pageNumber: 1, chunkIndex: 0, score: 0.95 },
        { content: "delta", pageNumber: 4, chunkIndex: 0, score: 0.7 },
        { content: "zeta", pageNumber: 2, chunkIndex: 0, score: 0.85 },
      ]);

      const msgRes = await request(app)
        .post(`/api/conversations/${conversationId}/messages`)
        .set("Authorization", `Bearer ${token}`)
        .send({ question: "Which pages cover this?" })
        .expect(200);

      const events = msgRes.text
        .split("\n\n")
        .filter(Boolean)
        .map((event) => JSON.parse(event.replace("data: ", "")));

      const doneEvent = events.find((e) => e.done === true);
      expect(doneEvent.matchedChunks.map((c) => c.pageNumber)).toEqual([1, 2, 3, 4]);
      expect(doneEvent.matchedChunks.find((c) => c.pageNumber === 3).score).toBe(0.9);

      const convRes = await request(app)
        .get(`/api/conversations/${conversationId}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      const assistantMsg = convRes.body.messages[1];
      expect(assistantMsg.citations.map((c) => c.pageNumber)).toEqual([1, 2, 3, 4]);
      expect(assistantMsg.citations.find((c) => c.pageNumber === 3).score).toBe(0.9);
    });

    it("returns no citations for a greeting and skips retrieval", async () => {
      const { searchChunks } = require("../src/services/retrieval.service");
      const { classifyMessage } = require("../src/services/llm.service");
      searchChunks.mockClear();
      classifyMessage.mockClear();

      const msgRes = await request(app)
        .post(`/api/conversations/${conversationId}/messages`)
        .set("Authorization", `Bearer ${token}`)
        .send({ question: "hi" })
        .expect(200);

      const events = msgRes.text
        .split("\n\n")
        .filter(Boolean)
        .map((event) => JSON.parse(event.replace("data: ", "")));

      expect(events.some((e) => e.content !== undefined)).toBe(true);

      const doneEvent = events.find((e) => e.done === true);
      expect(doneEvent.matchedChunks).toEqual([]);

      expect(searchChunks).not.toHaveBeenCalled();
      expect(classifyMessage).not.toHaveBeenCalled();

      const convRes = await request(app)
        .get(`/api/conversations/${conversationId}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(convRes.body.messages[1].citations).toEqual([]);
    });

    it("skips the classifier for obvious small talk like 'thanks'", async () => {
      const { searchChunks } = require("../src/services/retrieval.service");
      const { classifyMessage } = require("../src/services/llm.service");
      searchChunks.mockClear();
      classifyMessage.mockClear();

      const msgRes = await request(app)
        .post(`/api/conversations/${conversationId}/messages`)
        .set("Authorization", `Bearer ${token}`)
        .send({ question: "thanks" })
        .expect(200);

      const events = msgRes.text
        .split("\n\n")
        .filter(Boolean)
        .map((event) => JSON.parse(event.replace("data: ", "")));

      const doneEvent = events.find((e) => e.done === true);
      expect(doneEvent.matchedChunks).toEqual([]);

      expect(searchChunks).not.toHaveBeenCalled();
      expect(classifyMessage).not.toHaveBeenCalled();

      const convRes = await request(app)
        .get(`/api/conversations/${conversationId}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(convRes.body.messages[1].citations).toEqual([]);
    });

    it("treats praise/small talk like 'good boy' as small talk with no citations", async () => {
      const { searchChunks } = require("../src/services/retrieval.service");
      const { classifyMessage } = require("../src/services/llm.service");
      searchChunks.mockClear();
      classifyMessage.mockClear();

      const msgRes = await request(app)
        .post(`/api/conversations/${conversationId}/messages`)
        .set("Authorization", `Bearer ${token}`)
        .send({ question: "good boy" })
        .expect(200);

      const events = msgRes.text
        .split("\n\n")
        .filter(Boolean)
        .map((event) => JSON.parse(event.replace("data: ", "")));

      expect(events.some((e) => e.content !== undefined)).toBe(true);

      const doneEvent = events.find((e) => e.done === true);
      expect(doneEvent.matchedChunks).toEqual([]);
      expect(searchChunks).not.toHaveBeenCalled();
      expect(classifyMessage).not.toHaveBeenCalled();

      const convRes = await request(app)
        .get(`/api/conversations/${conversationId}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(convRes.body.messages[1].citations).toEqual([]);
    });

    it("treats 'how are you' as small talk but 'how good is coffee' as a real question", async () => {
      const { searchChunks } = require("../src/services/retrieval.service");
      const { classifyMessage } = require("../src/services/llm.service");

      searchChunks.mockClear();
      classifyMessage.mockClear();
      await request(app)
        .post(`/api/conversations/${conversationId}/messages`)
        .set("Authorization", `Bearer ${token}`)
        .send({ question: "how are you" })
        .expect(200);
      expect(searchChunks).not.toHaveBeenCalled();
      expect(classifyMessage).not.toHaveBeenCalled();

      searchChunks.mockClear();
      classifyMessage.mockClear();
      await request(app)
        .post(`/api/conversations/${conversationId}/messages`)
        .set("Authorization", `Bearer ${token}`)
        .send({ question: "how good is coffee" })
        .expect(200);
      expect(classifyMessage).toHaveBeenCalledTimes(1);
      expect(searchChunks).toHaveBeenCalledTimes(1);
    });

    it("treats a greeting plus a real question as a real question", async () => {
      const { searchChunks } = require("../src/services/retrieval.service");
      searchChunks.mockClear();

      const msgRes = await request(app)
        .post(`/api/conversations/${conversationId}/messages`)
        .set("Authorization", `Bearer ${token}`)
        .send({ question: "hi, what is caffeine?" })
        .expect(200);

      const events = msgRes.text
        .split("\n\n")
        .filter(Boolean)
        .map((event) => JSON.parse(event.replace("data: ", "")));

      const doneEvent = events.find((e) => e.done === true);
      expect(doneEvent.matchedChunks).toHaveLength(1);

      expect(searchChunks).toHaveBeenCalledTimes(1);
    });

    it("returns the real page number (page 4) in citations, not page 1", async () => {
      const { searchChunks } = require("../src/services/retrieval.service");
      searchChunks.mockResolvedValueOnce([
        { content: "Details that answer the question live on page four.", pageNumber: 4, chunkIndex: 0, score: 0.9 },
      ]);

      const msgRes = await request(app)
        .post(`/api/conversations/${conversationId}/messages`)
        .set("Authorization", `Bearer ${token}`)
        .send({ question: "What is on page four?" })
        .expect(200);

      const events = msgRes.text
        .split("\n\n")
        .filter(Boolean)
        .map((event) => JSON.parse(event.replace("data: ", "")));

      const doneEvent = events.find((e) => e.done === true);
      expect(doneEvent.matchedChunks).toHaveLength(1);
      expect(doneEvent.matchedChunks[0].pageNumber).toBe(4);

      const convRes = await request(app)
        .get(`/api/conversations/${conversationId}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      const citations = convRes.body.messages[1].citations;
      expect(citations).toHaveLength(1);
      expect(citations[0].pageNumber).toBe(4);
    });

    it("drops citations when the model answers it lacks information", async () => {
      const { searchChunks } = require("../src/services/retrieval.service");
      const { streamAnswer } = require("../src/services/llm.service");

      searchChunks.mockResolvedValueOnce([
        { content: "Some unrelated context about trade.", pageNumber: 3, chunkIndex: 0, score: 0.8 },
      ]);
      streamAnswer.mockImplementationOnce(async function* () {
        yield "I don't have enough information in this document to answer that question.";
      });

      const msgRes = await request(app)
        .post(`/api/conversations/${conversationId}/messages`)
        .set("Authorization", `Bearer ${token}`)
        .send({ question: "speed of airplane" })
        .expect(200);

      const events = msgRes.text
        .split("\n\n")
        .filter(Boolean)
        .map((event) => JSON.parse(event.replace("data: ", "")));

      const doneEvent = events.find((e) => e.done === true);
      expect(doneEvent.matchedChunks).toEqual([]);

      const convRes = await request(app)
        .get(`/api/conversations/${conversationId}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(convRes.body.messages[1].citations).toEqual([]);
    });
  });

  describe("GET /api/conversations", () => {
    it("lists conversations", async () => {
      const res = await request(app)
        .get("/api/conversations")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0]._id).toBe(conversationId);
    });
  });

  describe("Generic 500 / SSE error responses (no error.message leak)", () => {
    it("returns generic JSON error when a pre-stream DB failure occurs", async () => {
      const Conversation = require("../src/models/Conversation");
      jest.spyOn(Conversation, "findOne").mockRejectedValueOnce(new Error("db secret crash"));

      const res = await request(app)
        .post(`/api/conversations/${conversationId}/messages`)
        .set("Authorization", `Bearer ${token}`)
        .send({ question: "What is on page one?" })
        .expect(500);

      expect(res.body.message).toBe("Something went wrong");
      expect(JSON.stringify(res.body)).not.toContain("db secret");
    });

    it("returns generic error in SSE stream when mid-stream embedding fails", async () => {
      const { embedText } = require("../src/services/embedding.service");
      embedText.mockRejectedValueOnce(new Error("embedding provider secret"));

      const msgRes = await request(app)
        .post(`/api/conversations/${conversationId}/messages`)
        .set("Authorization", `Bearer ${token}`)
        .send({ question: "What is on page one?" })
        .expect(200);

      const events = msgRes.text
        .split("\n\n")
        .filter(Boolean)
        .map((event) => JSON.parse(event.replace("data: ", "")));

      const errorEvent = events.find((e) => e.error !== undefined);
      expect(errorEvent).toBeDefined();
      expect(errorEvent.error).toBe("Something went wrong");
      expect(JSON.stringify(events)).not.toContain("embedding provider secret");
    });

    it("returns generic error in SSE stream when the LLM stream throws", async () => {
      const { streamAnswer } = require("../src/services/llm.service");
      streamAnswer.mockImplementationOnce(async function* () {
        throw new Error("llm secret failure");
      });

      const msgRes = await request(app)
        .post(`/api/conversations/${conversationId}/messages`)
        .set("Authorization", `Bearer ${token}`)
        .send({ question: "What is on page one?" })
        .expect(200);

      const events = msgRes.text
        .split("\n\n")
        .filter(Boolean)
        .map((event) => JSON.parse(event.replace("data: ", "")));

      const errorEvent = events.find((e) => e.error !== undefined);
      expect(errorEvent).toBeDefined();
      expect(errorEvent.error).toBe("Something went wrong");
      expect(JSON.stringify(events)).not.toContain("llm secret");
    });

    it("returns generic JSON error when creating a conversation fails", async () => {
      const Conversation = require("../src/models/Conversation");
      jest.spyOn(Conversation, "create").mockRejectedValueOnce(new Error("create secret"));

      const res = await request(app)
        .post("/api/conversations")
        .set("Authorization", `Bearer ${token}`)
        .send({ documentId: docId })
        .expect(500);

      expect(res.body.message).toBe("Something went wrong");
      expect(JSON.stringify(res.body)).not.toContain("create secret");
    });
  });

  describe("Ownership isolation", () => {
    it("returns 404 when another user tries to access conversation", async () => {
      const userBRes = await request(app)
        .post("/api/auth/signup")
        .send({ name: "Other", email: "other@test.com", password: "Password1" });
      const tokenB = userBRes.body.token;

      await request(app)
        .get(`/api/conversations/${conversationId}`)
        .set("Authorization", `Bearer ${tokenB}`)
        .expect(404);
    });
  });
});
