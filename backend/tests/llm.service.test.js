jest.mock("../src/config/groq", () => {
  const create = jest.fn();
  const mockGroq = {
    chat: {
      completions: {
        create,
      },
    },
    GROQ_MODEL: "openai/gpt-oss-20b",
    GROQ_CLASSIFIER_MODEL: "openai/gpt-oss-20b",
  };
  return mockGroq;
});

const groq = require("../src/config/groq");
const {
  generateAnswer,
  streamAnswer,
  streamSummarization,
  streamSmallTalk,
  classifyMessage,
  NO_CONTEXT_ANSWER,
} = require("../src/services/llm.service");

describe("llm.service", () => {
  beforeEach(() => {
    groq.chat.completions.create.mockReset();
  });

  test("generateAnswer uses GROQ_MODEL and returns completion content", async () => {
    groq.chat.completions.create.mockResolvedValueOnce({
      choices: [{ message: { content: "Page 1 states the total is 42." } }],
    });

    const answer = await generateAnswer("What is the total?", [
      { pageNumber: 1, content: "The total is 42." },
    ]);

    expect(answer).toBe("Page 1 states the total is 42.");
    expect(groq.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai/gpt-oss-20b",
        temperature: 0.3,
        max_tokens: 2048,
        reasoning_effort: "low",
      }),
    );
  });

  test("generateAnswer returns NO_CONTEXT_ANSWER when chunks are empty", async () => {
    const answer = await generateAnswer("What is the total?", []);
    expect(answer).toBe(NO_CONTEXT_ANSWER);
    expect(groq.chat.completions.create).not.toHaveBeenCalled();
  });

  test("streamAnswer streams chunks using GROQ_MODEL", async () => {
    async function* fakeStream() {
      yield { choices: [{ delta: { content: "Hello " } }] };
      yield { choices: [{ delta: { content: "world" } }] };
    }
    groq.chat.completions.create.mockResolvedValueOnce(fakeStream());

    const parts = [];
    for await (const part of streamAnswer("Hi?", [
      { pageNumber: 2, content: "Hello world" },
    ])) {
      parts.push(part);
    }

    expect(parts.join("")).toBe("Hello world");
    expect(groq.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai/gpt-oss-20b",
        stream: true,
        reasoning_effort: "low",
      }),
    );
  });

  test("streamSummarization streams summary using GROQ_MODEL", async () => {
    async function* fakeStream() {
      yield { choices: [{ delta: { content: "Summary text" } }] };
    }
    groq.chat.completions.create.mockResolvedValueOnce(fakeStream());

    const parts = [];
    for await (const part of streamSummarization("Summarize", "Doc text")) {
      parts.push(part);
    }

    expect(parts.join("")).toBe("Summary text");
    expect(groq.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai/gpt-oss-20b",
        stream: true,
      }),
    );
  });

  test("streamSmallTalk streams reply using GROQ_MODEL", async () => {
    async function* fakeStream() {
      yield { choices: [{ delta: { content: "Hi there!" } }] };
    }
    groq.chat.completions.create.mockResolvedValueOnce(fakeStream());

    const parts = [];
    for await (const part of streamSmallTalk("Hello")) {
      parts.push(part);
    }

    expect(parts.join("")).toBe("Hi there!");
    expect(groq.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai/gpt-oss-20b",
        stream: true,
      }),
    );
  });

  test("classifyMessage classifies SMALL_TALK, OUT_OF_SCOPE, and QUESTION", async () => {
    groq.chat.completions.create
      .mockResolvedValueOnce({ choices: [{ message: { content: "SMALL_TALK" } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: "OUT_OF_SCOPE" } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: "QUESTION" } }] });

    await expect(classifyMessage("hey there")).resolves.toBe("SMALL_TALK");
    await expect(classifyMessage("rewrite this PDF")).resolves.toBe("OUT_OF_SCOPE");
    await expect(classifyMessage("what is on page 2?")).resolves.toBe("QUESTION");

    expect(groq.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai/gpt-oss-20b",
        temperature: 0,
        max_tokens: 2048,
        reasoning_effort: "low",
      }),
    );
  });
});
