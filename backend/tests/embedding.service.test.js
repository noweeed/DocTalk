const mockEmbedContent = jest.fn();
const mockBatchEmbedContents = jest.fn();

jest.mock("../src/config/gemini", () => ({
  keyCount: 1,
  getNextGenAI: jest.fn(() => ({
    getGenerativeModel: jest.fn(() => ({
      embedContent: mockEmbedContent,
      batchEmbedContents: mockBatchEmbedContents,
    })),
  })),
}));

jest.mock("../src/models/Chunk", () => ({
  find: jest.fn(),
  updateOne: jest.fn(),
}));

const Chunk = require("../src/models/Chunk");
const {
  embedText,
  embedChunksForDocument,
} = require("../src/services/embedding.service");

describe("embedding.service", () => {
  beforeEach(() => {
    mockEmbedContent.mockReset();
    mockBatchEmbedContents.mockReset();
    Chunk.find.mockReset();
    Chunk.updateOne.mockReset();
  });

  test("embedText requests 768-dimensional embedding from gemini-embedding-001", async () => {
    const vector = new Array(768).fill(0.25);
    mockEmbedContent.mockResolvedValueOnce({ embedding: { values: vector } });

    const result = await embedText("hello world");

    expect(result).toHaveLength(768);
    expect(mockEmbedContent).toHaveBeenCalledWith({
      content: { parts: [{ text: "hello world" }] },
      outputDimensionality: 768,
    });
  });

  test("embedChunksForDocument embeds via batch and updates all chunks", async () => {
    Chunk.find.mockResolvedValueOnce([
      { _id: "c1", content: "chunk 1" },
      { _id: "c2", content: "chunk 2" },
    ]);
    mockBatchEmbedContents.mockResolvedValueOnce({
      embeddings: [
        { values: new Array(768).fill(0.1) },
        { values: new Array(768).fill(0.2) },
      ],
    });
    Chunk.updateOne.mockResolvedValue({ modifiedCount: 1 });

    const count = await embedChunksForDocument("doc-1");

    expect(count).toBe(2);
    expect(Chunk.updateOne).toHaveBeenCalledTimes(2);
  });

  test("embedChunksForDocument falls back per chunk and throws on partial failure", async () => {
    Chunk.find.mockResolvedValueOnce([
      { _id: "c1", content: "chunk 1" },
      { _id: "c2", content: "chunk 2" },
    ]);
    mockBatchEmbedContents.mockRejectedValueOnce(new Error("batch failed"));
    mockEmbedContent
      .mockResolvedValueOnce({ embedding: { values: new Array(768).fill(0.1) } })
      .mockRejectedValueOnce(new Error("401 Unauthorized: API key not valid"));
    Chunk.updateOne.mockResolvedValue({ modifiedCount: 1 });

    await expect(embedChunksForDocument("doc-1")).rejects.toThrow(
      /Embedding failed for 1 of 2 chunks: 401 Unauthorized/,
    );
  });

  test("embedChunksForDocument throws root cause when all chunks fail", async () => {
    Chunk.find.mockResolvedValueOnce([{ _id: "c1", content: "chunk 1" }]);
    mockBatchEmbedContents.mockRejectedValueOnce(
      new Error("401 Unauthorized: API key not valid"),
    );
    mockEmbedContent.mockRejectedValueOnce(
      new Error("401 Unauthorized: API key not valid"),
    );

    await expect(embedChunksForDocument("doc-1")).rejects.toThrow(
      /Embedding failed for all chunks: 401 Unauthorized/,
    );
  });
});
