const request = require("supertest");
const app = require("../src/server");
const { connect, clearCollections } = require("./setup");

beforeAll(async () => await connect());
afterEach(async () => await clearCollections());

describe("Rate limiter proxy awareness", () => {
  it("trusts exactly one upstream proxy hop", () => {
    expect(app.get("trust proxy")).toBe(1);
  });

  it("handles proxied requests normally (no-op without a real proxy)", async () => {
    const res = await request(app)
      .get("/health")
      .set("X-Forwarded-For", "203.0.113.9")
      .expect(200);

    expect(res.status).toBe(200);
  });

  it("auth endpoints keep responding normally within relaxed test limits", async () => {
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", "198.51.100.10")
        .send({ email: "nobody@test.com", password: "WrongPass1" });

      expect(res.status).toBe(401);
    }
  });
});
