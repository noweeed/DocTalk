const request = require("supertest");
const app = require("../src/server");
const { connect, clearCollections } = require("./setup");
const { ipKeyGenerator } = require("express-rate-limit");
const authRoutes = require("../src/routes/auth.routes");

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

describe("Auth route rate-limit bucket separation", () => {
  it("/oauth/exchange uses its own IP-only limiter, not /login's bucket", async () => {
    const ip = "198.51.100.42";
    const ipKey = ipKeyGenerator(ip);
    const loginKey = `${ipKey}-victim@test.com`;
    const noEmailKey = `${ipKey}-no-email`;

    await authRoutes.authLimiter.resetKey(loginKey);
    await authRoutes.authLimiter.resetKey(noEmailKey);
    await authRoutes.oauthExchangeLimiter.resetKey(ipKey);

    // Exhaust /login's IP+email bucket for this account.
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", ip)
        .send({ email: "victim@test.com", password: "WrongPass1" });
      expect(res.status).toBe(401);
    }

    const loginHits = await authRoutes.authLimiter.getKey(loginKey);
    expect(loginHits.totalHits).toBe(5);

    // The same IP can still exchange OAuth codes: separate, more lenient bucket.
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post("/api/auth/oauth/exchange")
        .set("X-Forwarded-For", ip)
        .send({ code: `invalid-${i}` });
      expect(res.status).toBe(400);
    }

    const oauthHits = await authRoutes.oauthExchangeLimiter.getKey(ipKey);
    expect(oauthHits.totalHits).toBe(5);

    // The /oauth/exchange calls never touched authLimiter's IP+email fallback bucket.
    const noEmailHits = await authRoutes.authLimiter.getKey(noEmailKey);
    expect(noEmailHits).toBeUndefined();
  });

  it("reset-password and password/confirm use the IP-only limiter, not authLimiter", async () => {
    const ip = "198.51.100.43";
    const ipKey = ipKeyGenerator(ip);

    await authRoutes.passwordTokenLimiter.resetKey(ipKey);
    await authRoutes.authLimiter.resetKey(`${ipKey}-no-email`);

    for (let i = 0; i < 3; i++) {
      await request(app)
        .post("/api/auth/reset-password")
        .set("X-Forwarded-For", ip)
        .send({ token: `bad-${i}`, newPassword: "NewPass1" });

      await request(app)
        .post("/api/auth/password/confirm")
        .set("X-Forwarded-For", ip)
        .send({ token: `bad-${i}`, newPassword: "NewPass1" });
    }

    const hits = await authRoutes.passwordTokenLimiter.getKey(ipKey);
    expect(hits.totalHits).toBe(6);

    const noEmailHits = await authRoutes.authLimiter.getKey(`${ipKey}-no-email`);
    expect(noEmailHits).toBeUndefined();
  });

  it("login stays keyed by IP+email so accounts don't share a bucket", async () => {
    const ip = "198.51.100.44";
    const ipKey = ipKeyGenerator(ip);

    for (const email of ["alice@test.com", "bob@test.com"]) {
      await authRoutes.authLimiter.resetKey(`${ipKey}-${email}`);
    }

    await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", ip)
      .send({ email: "alice@test.com", password: "WrongPass1" });

    await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", ip)
      .send({ email: "alice@test.com", password: "WrongPass1" });

    const alice = await authRoutes.authLimiter.getKey(`${ipKey}-alice@test.com`);
    const bob = await authRoutes.authLimiter.getKey(`${ipKey}-bob@test.com`);
    expect(alice.totalHits).toBe(2);
    expect(bob).toBeUndefined();
  });
});
