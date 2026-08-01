const errorHandler = require("../src/middleware/error.middleware");

describe("Error middleware", () => {
  let consoleErrorSpy;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("returns generic message for 500 errors", () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    errorHandler(new Error("secret stack trace"), {}, res, () => {});
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ message: "Something went wrong" });
  });

  it("returns generic message for errors with an explicit 500 status", () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const err = new Error("secret internal");
    err.status = 500;
    errorHandler(err, {}, res, () => {});
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ message: "Something went wrong" });
  });

  it("keeps the message for intentional 4xx errors set via status", () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const err = new Error("Document not found");
    err.status = 404;
    errorHandler(err, {}, res, () => {});
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: "Document not found" });
  });

  it("keeps the message for intentional 4xx errors set via statusCode", () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const err = new Error("Only PDF files are allowed");
    err.statusCode = 400;
    errorHandler(err, {}, res, () => {});
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "Only PDF files are allowed" });
  });
});
