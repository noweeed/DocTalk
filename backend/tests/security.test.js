const request = require("supertest");
const app = require("../src/server");
const { connect, clearCollections } = require("./setup");

beforeAll(async () => await connect());
afterEach(async () => await clearCollections());

describe("Security headers (helmet + CSP)", () => {
  it("sets nosniff, frame and CSP headers on the health endpoint", async () => {
    const res = await request(app).get("/health").expect(200);

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(res.headers["strict-transport-security"]).toBeDefined();
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(res.headers["content-security-policy"]).toContain("connect-src 'self'");
  });

  it("sets security headers on authenticated document endpoints", async () => {
    const signupRes = await request(app)
      .post("/api/auth/signup")
      .send({ name: "Sec User", email: "sec@test.com", password: "Password1" });

    const res = await request(app)
      .get("/api/documents")
      .set("Authorization", `Bearer ${signupRes.body.token}`)
      .expect(200);

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
  });

  it("returns security headers on error responses too", async () => {
    const res = await request(app).get("/api/documents").expect(401);

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toBeDefined();
  });
});
