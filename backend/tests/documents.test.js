const fs = require("fs");
const path = require("path");
const request = require("supertest");
const app = require("../src/server");
const Chunk = require("../src/models/Chunk");
const Document = require("../src/models/Document");
const { connect, clearCollections } = require("./setup");

jest.mock("pdf-parse", () => require("./mocks/pdf-parse.mock"));
jest.mock("../src/services/embedding.service", () =>
  require("./mocks/embedding.mock")
);

beforeAll(async () => await connect());
afterEach(async () => {
  await clearCollections();
  jest.restoreAllMocks();
  require("../src/services/chunking.service").pdfParseConfig.timeoutMs = 30000;
});

const samplePdf = fs.readFileSync(path.join(__dirname, "fixtures", "sample.pdf"));

const uploadDoc = async (token) => {
  const res = await request(app)
    .post("/api/documents")
    .set("Authorization", `Bearer ${token}`)
    .attach("file", samplePdf, {
      filename: "sample.pdf",
      contentType: "application/pdf",
    });
  return res.body;
};

describe("Documents", () => {
  let token;

  beforeEach(async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ name: "Doc User", email: "doc@test.com", password: "Password1" });
    token = res.body.token;
  });

  describe("POST /api/documents", () => {
    it("uploads a PDF and returns 201 with correct shape", async () => {
      const res = await request(app)
        .post("/api/documents")
        .set("Authorization", `Bearer ${token}`)
        .attach("file", samplePdf, {
          filename: "sample.pdf",
          contentType: "application/pdf",
        })
        .expect(201);

      expect(res.body.documentId).toBeDefined();
      expect(res.body.title).toBe("sample.pdf");
      expect(res.body.chunkCount).toBeGreaterThanOrEqual(1);
      expect(res.body.status).toBe("ready");
    });
  });

  describe("GET /api/documents", () => {
    it("returns uploaded documents", async () => {
      const uploadRes = await uploadDoc(token);

      const res = await request(app)
        .get("/api/documents")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body.length).toBe(1);
      expect(res.body[0]._id).toBe(uploadRes.documentId);
    });

    it("returns empty for starred filter before starring", async () => {
      await uploadDoc(token);

      const res = await request(app)
        .get("/api/documents?filter=starred")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveLength(0);
    });

    it("returns empty for trash filter initially", async () => {
      await uploadDoc(token);

      const res = await request(app)
        .get("/api/documents?filter=trash")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveLength(0);
    });
  });

  describe("GET /api/documents/:id", () => {
    it("returns the document", async () => {
      const uploadRes = await uploadDoc(token);

      const res = await request(app)
        .get(`/api/documents/${uploadRes.documentId}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body._id).toBe(uploadRes.documentId);
      expect(res.body.title).toBe("sample.pdf");
      expect(res.body.lastOpenedAt).toBeDefined();
    });

    it("returns 404 for nonexistent document", async () => {
      const { ObjectId } = require("mongoose").Types;
      const fakeId = new ObjectId();

      await request(app)
        .get(`/api/documents/${fakeId}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(404);
    });
  });

  describe("PATCH /api/documents/:id", () => {
    it("stars a document", async () => {
      const uploadRes = await uploadDoc(token);

      const res = await request(app)
        .patch(`/api/documents/${uploadRes.documentId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ isStarred: true })
        .expect(200);

      expect(res.body.isStarred).toBe(true);
    });

    it("renames a document", async () => {
      const uploadRes = await uploadDoc(token);

      const res = await request(app)
        .patch(`/api/documents/${uploadRes.documentId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ title: "Renamed Doc" })
        .expect(200);

      expect(res.body.title).toBe("Renamed Doc");
    });
  });

  describe("Filter after starring", () => {
    it("returns starred documents", async () => {
      const uploadRes = await uploadDoc(token);

      await request(app)
        .patch(`/api/documents/${uploadRes.documentId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ isStarred: true });

      const res = await request(app)
        .get("/api/documents?filter=starred")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0]._id).toBe(uploadRes.documentId);
    });
  });

  describe("DELETE /api/documents/:id (soft delete)", () => {
    it("moves document to trash", async () => {
      const uploadRes = await uploadDoc(token);

      const res = await request(app)
        .delete(`/api/documents/${uploadRes.documentId}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body.message).toBe("Document moved to trash");
    });

    it("excludes trashed from default list", async () => {
      const uploadRes = await uploadDoc(token);

      await request(app)
        .delete(`/api/documents/${uploadRes.documentId}`)
        .set("Authorization", `Bearer ${token}`);

      const res = await request(app)
        .get("/api/documents")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveLength(0);
    });

    it("includes trashed in trash filter", async () => {
      const uploadRes = await uploadDoc(token);

      await request(app)
        .delete(`/api/documents/${uploadRes.documentId}`)
        .set("Authorization", `Bearer ${token}`);

      const res = await request(app)
        .get("/api/documents?filter=trash")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0]._id).toBe(uploadRes.documentId);
    });
  });

  describe("Chunk page numbers", () => {
    afterEach(() => {
      require("./mocks/pdf-parse.mock").setPageTexts(["Hello Test Document\n"]);
    });

    it("tags each chunk with the actual PDF page number", async () => {
      require("./mocks/pdf-parse.mock").setPageTexts([
        "Apple orchard management details live on this first page.",
        "Banana cultivation practices are discussed on this page.",
        "",
        "Cherry harvest yields are listed here on page four.",
      ]);

      const uploadRes = await uploadDoc(token);
      const chunks = await Chunk.find({
        documentId: uploadRes.documentId,
      }).sort({ pageNumber: 1, chunkIndex: 1 });

      expect(uploadRes.chunkCount).toBe(3);
      expect(chunks.map((c) => c.pageNumber)).toEqual([1, 2, 4]);
      expect(chunks[0].content).toContain("Apple");
      expect(chunks[2].content).toContain("Cherry");
    });
  });

  describe("POST /api/documents/:id/restore", () => {
    it("restores a trashed document to default list", async () => {
      const uploadRes = await uploadDoc(token);

      await request(app)
        .delete(`/api/documents/${uploadRes.documentId}`)
        .set("Authorization", `Bearer ${token}`);

      await request(app)
        .post(`/api/documents/${uploadRes.documentId}/restore`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      const res = await request(app)
        .get("/api/documents")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0]._id).toBe(uploadRes.documentId);
    });
  });

  describe("GET /api/documents/:id/file", () => {
    it("streams the PDF with correct content type", async () => {
      const uploadRes = await uploadDoc(token);

      const res = await request(app)
        .get(`/api/documents/${uploadRes.documentId}/file`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    });

    it("returns a well-formed Content-Disposition header for filenames with quotes (L2)", async () => {
      const uploadRes = await uploadDoc(token);

      await request(app)
        .patch(`/api/documents/${uploadRes.documentId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ title: 'my"doc.pdf' })
        .expect(200);

      const res = await request(app)
        .get(`/api/documents/${uploadRes.documentId}/file`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      const disposition = res.headers["content-disposition"];
      expect(disposition).toBeDefined();
      expect(disposition).not.toMatch(/[\r\n]/);
      expect(disposition).toBe(
        "inline; filename=\"my_doc.pdf\"; filename*=UTF-8''my%22doc.pdf"
      );
    });
  });

  describe("DELETE /api/documents/:id/permanent", () => {
    it("permanently deletes document and its chunks", async () => {
      const uploadRes = await uploadDoc(token);
      const docId = uploadRes.documentId;

      const chunksBefore = await Chunk.find({ documentId: docId });
      expect(chunksBefore.length).toBeGreaterThanOrEqual(1);

      await request(app)
        .delete(`/api/documents/${docId}/permanent`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      const chunksAfter = await Chunk.find({ documentId: docId });
      expect(chunksAfter).toHaveLength(0);
    });
  });

  describe("Generic 500 responses (no error.message leak)", () => {
    it("returns generic message when the upload pipeline fails", async () => {
      const { embedChunksForDocument } = require("../src/services/embedding.service");
      embedChunksForDocument.mockRejectedValueOnce(new Error("embedding api secret"));

      const res = await request(app)
        .post("/api/documents")
        .set("Authorization", `Bearer ${token}`)
        .attach("file", samplePdf, {
          filename: "sample.pdf",
          contentType: "application/pdf",
        })
        .expect(500);

      expect(res.body.message).toBe("Something went wrong");
      expect(JSON.stringify(res.body)).not.toContain("embedding api secret");
    });

    it("returns generic message when the document limit check fails", async () => {
      const User = require("../src/models/User");
      jest.spyOn(User, "findById").mockRejectedValueOnce(new Error("plan check secret"));

      const res = await request(app)
        .post("/api/documents")
        .set("Authorization", `Bearer ${token}`)
        .attach("file", samplePdf, {
          filename: "sample.pdf",
          contentType: "application/pdf",
        })
        .expect(500);

      expect(res.body.message).toBe("Something went wrong");
      expect(JSON.stringify(res.body)).not.toContain("plan check secret");
    });

    it("returns generic message when fetching a single document fails", async () => {
      const uploadRes = await uploadDoc(token);
      jest.spyOn(Document, "findOne").mockRejectedValueOnce(new Error("fetch secret"));

      const res = await request(app)
        .get(`/api/documents/${uploadRes.documentId}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(500);

      expect(res.body.message).toBe("Something went wrong");
      expect(JSON.stringify(res.body)).not.toContain("fetch secret");
    });

    it("returns generic message via the global error handler for an uncaught rejection", async () => {
      jest.spyOn(Document, "create").mockRejectedValueOnce(new Error("create secret"));

      const res = await request(app)
        .post("/api/documents")
        .set("Authorization", `Bearer ${token}`)
        .attach("file", samplePdf, {
          filename: "sample.pdf",
          contentType: "application/pdf",
        })
        .expect(500);

      expect(res.body.message).toBe("Something went wrong");
      expect(JSON.stringify(res.body)).not.toContain("create secret");
    });
  });

  describe("Upload validation hardening (M4)", () => {
    it("rejects a forged PDF (non-PDF bytes with application/pdf mimetype)", async () => {
      const res = await request(app)
        .post("/api/documents")
        .set("Authorization", `Bearer ${token}`)
        .attach("file", Buffer.from("plain text that is definitely not a pdf"), {
          filename: "fake.pdf",
          contentType: "application/pdf",
        })
        .expect(400);

      expect(res.body.message).toBe("Invalid PDF file");

      const docs = await Document.find({});
      expect(docs).toHaveLength(0);
    });

    it("returns 500 and marks the document failed when pdf-parse times out", async () => {
      const { pdfParseConfig } = require("../src/services/chunking.service");
      const pdfParseMock = require("pdf-parse");
      pdfParseConfig.timeoutMs = 100;
      pdfParseMock.mockImplementationOnce(() => new Promise(() => {}));

      const res = await request(app)
        .post("/api/documents")
        .set("Authorization", `Bearer ${token}`)
        .attach("file", samplePdf, {
          filename: "sample.pdf",
          contentType: "application/pdf",
        })
        .expect(500);

      expect(res.body.message).toBe("Something went wrong");

      const docs = await Document.find({});
      expect(docs).toHaveLength(1);
      expect(docs[0].status).toBe("failed");
    });
  });

  describe("Ownership isolation", () => {
    it("returns 404 when another user tries to access document", async () => {
      const uploadRes = await uploadDoc(token);
      const docId = uploadRes.documentId;

      const userBRes = await request(app)
        .post("/api/auth/signup")
        .send({ name: "Other", email: "other@test.com", password: "Password1" });
      const tokenB = userBRes.body.token;

      await request(app)
        .get(`/api/documents/${docId}`)
        .set("Authorization", `Bearer ${tokenB}`)
        .expect(404);

      await request(app)
        .patch(`/api/documents/${docId}`)
        .set("Authorization", `Bearer ${tokenB}`)
        .send({ title: "Hacked" })
        .expect(404);

      await request(app)
        .delete(`/api/documents/${docId}`)
        .set("Authorization", `Bearer ${tokenB}`)
        .expect(404);
    });
  });
});
