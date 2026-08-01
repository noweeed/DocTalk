const request = require("supertest");
const crypto = require("crypto");
const app = require("../src/server");
const { connect, clearCollections } = require("./setup");
const OAuthExchangeCode = require("../src/models/OAuthExchangeCode");

beforeAll(async () => await connect());
afterEach(async () => await clearCollections());

describe("Auth", () => {
  describe("POST /api/auth/signup", () => {
    it("returns 400 for weak password", async () => {
      const res = await request(app)
        .post("/api/auth/signup")
        .send({ name: "Test", email: "test@test.com", password: "weak" });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Password must be/);
    });

    it("returns 201 with correct shape for valid signup", async () => {
      const res = await request(app)
        .post("/api/auth/signup")
        .send({ name: "Test User", email: "test@test.com", password: "Password1" })
        .expect(201);

      expect(res.body.token).toBeDefined();
      expect(typeof res.body.token).toBe("string");
      expect(res.body.user).toMatchObject({
        name: "Test User",
        email: "test@test.com",
      });
      expect(res.body.user.id).toBeDefined();
      expect(res.body.user.createdAt).toBeDefined();
    });

    it("returns 409 for duplicate email", async () => {
      await request(app)
        .post("/api/auth/signup")
        .send({ name: "Test", email: "dup@test.com", password: "Password1" });

      const res = await request(app)
        .post("/api/auth/signup")
        .send({ name: "Test2", email: "dup@test.com", password: "Password1" });
      expect(res.status).toBe(409);
      expect(res.body.message).toBe("Email already in use");
    });
  });

  describe("POST /api/auth/login", () => {
    beforeEach(async () => {
      await request(app)
        .post("/api/auth/signup")
        .send({ name: "Test", email: "login@test.com", password: "Password1" });
    });

    it("returns 200 with token for correct credentials", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: "login@test.com", password: "Password1" })
        .expect(200);

      expect(res.body.token).toBeDefined();
      expect(res.body.user).toMatchObject({
        name: "Test",
        email: "login@test.com",
      });
    });

    it("returns 401 for wrong password", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: "login@test.com", password: "WrongPass1" });
      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Invalid credentials");
    });

    it("returns 401 for nonexistent email", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: "nobody@test.com", password: "Password1" });
      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Invalid credentials");
    });

    it("rejects a non-string email (NoSQL injection guard)", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: { $ne: null }, password: "Password1" });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Invalid request");
    });

    it("rejects a non-string password (NoSQL injection guard)", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: "login@test.com", password: { $gt: "" } });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Invalid request");
    });
  });

  describe("GET /api/auth/me", () => {
    it("returns 200 with user info for valid token", async () => {
      const signupRes = await request(app)
        .post("/api/auth/signup")
        .send({ name: "Me User", email: "me@test.com", password: "Password1" });

      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${signupRes.body.token}`)
        .expect(200);

      expect(res.body).toMatchObject({
        name: "Me User",
        email: "me@test.com",
      });
      expect(res.body.id).toBeDefined();
      expect(res.body.createdAt).toBeDefined();
      expect(res.body.passwordHash).toBeUndefined();
    });

    it("returns 401 for no token", async () => {
      const res = await request(app).get("/api/auth/me");
      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Unauthorized");
    });

    it("returns 401 for malformed token", async () => {
      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", "Bearer not.a.valid.token");
      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Unauthorized");
    });
  });

  describe("POST /api/auth/logout and token revocation", () => {
    it("revokes the token after logout", async () => {
      const signupRes = await request(app)
        .post("/api/auth/signup")
        .send({ name: "Logout", email: "logout@test.com", password: "Password1" });
      const token = signupRes.body.token;

      await request(app)
        .post("/api/auth/logout")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      const meRes = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${token}`);
      expect(meRes.status).toBe(401);
      expect(meRes.body.message).toBe("Token has been revoked");
    });

    it("allows fresh login after logout", async () => {
      await request(app)
        .post("/api/auth/signup")
        .send({ name: "Fresh", email: "fresh@test.com", password: "Password1" });

      const loginRes = await request(app)
        .post("/api/auth/login")
        .send({ email: "fresh@test.com", password: "Password1" });
      const oldToken = loginRes.body.token;

      await request(app)
        .post("/api/auth/logout")
        .set("Authorization", `Bearer ${oldToken}`)
        .expect(200);

      const newLoginRes = await request(app)
        .post("/api/auth/login")
        .send({ email: "fresh@test.com", password: "Password1" });
      expect(newLoginRes.status).toBe(200);
      expect(newLoginRes.body.token).toBeDefined();

      const meRes = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${newLoginRes.body.token}`);
      expect(meRes.status).toBe(200);
      expect(meRes.body.email).toBe("fresh@test.com");
    });
  });

  describe("Password reset / change token hardening", () => {
    it("rejects a non-string reset token (NoSQL injection guard)", async () => {
      const res = await request(app)
        .post("/api/auth/reset-password")
        .send({ token: { $ne: null }, newPassword: "Attacker1" });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Invalid request");
    });

    it("rejects a non-string confirm token (NoSQL injection guard)", async () => {
      const res = await request(app)
        .post("/api/auth/password/confirm")
        .send({ token: { $ne: null }, newPassword: "Attacker1" });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Invalid request");
    });

    it("rejects a non-string newPassword", async () => {
      const res = await request(app)
        .post("/api/auth/reset-password")
        .send({ token: "sometoken", newPassword: { $gt: "" } });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Invalid request");
    });
  });

  describe("Google OAuth state + exchange code", () => {
    it("rejects google callback when state is missing", async () => {
      const res = await request(app).get("/api/auth/google/callback?code=fake");
      expect(res.status).toBe(401);
    });

    it("rejects google callback when state does not match cookie", async () => {
      const res = await request(app)
        .get("/api/auth/google/callback?code=fake&state=attacker-state")
        .set("Cookie", "oauth_state=real-state");
      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Google authentication failed");
    });

    it("sets a state cookie and passes state to the google redirect", async () => {
      const res = await request(app).get("/api/auth/google");
      expect(res.status).toBe(302);
      const setCookie = res.headers["set-cookie"];
      expect(setCookie).toBeDefined();
      const stateCookie = setCookie.find((c) => c.startsWith("oauth_state="));
      expect(stateCookie).toBeDefined();
      expect(stateCookie).toContain("HttpOnly");
      expect(stateCookie).toContain("SameSite=Lax");
      expect(res.headers.location).toContain("state=");
    });

    it("exchanges a valid code once and rejects second use", async () => {
      const signupRes = await request(app)
        .post("/api/auth/signup")
        .send({ name: "OAuth User", email: "oauth@test.com", password: "Password1" });

      const code = crypto.randomUUID();
      await OAuthExchangeCode.create({
        code,
        token: signupRes.body.token,
        userId: signupRes.body.user.id,
        expiresAt: new Date(Date.now() + 60 * 1000),
      });

      const res = await request(app)
        .post("/api/auth/oauth/exchange")
        .send({ code })
        .expect(200);

      expect(res.body.token).toBe(signupRes.body.token);
      expect(res.body.user).toMatchObject({ email: "oauth@test.com" });

      const second = await request(app)
        .post("/api/auth/oauth/exchange")
        .send({ code });
      expect(second.status).toBe(400);
      expect(second.body.message).toBe("Invalid or expired code");
    });

    it("returns 400 for missing code", async () => {
      const res = await request(app).post("/api/auth/oauth/exchange").send({});
      expect(res.status).toBe(400);
    });

    it("returns 400 for a non-string code (NoSQL injection guard)", async () => {
      const res = await request(app)
        .post("/api/auth/oauth/exchange")
        .send({ code: { $ne: null } });
      expect(res.status).toBe(400);
    });

    it("returns 400 for an unknown code", async () => {
      const res = await request(app)
        .post("/api/auth/oauth/exchange")
        .send({ code: "does-not-exist" });
      expect(res.status).toBe(400);
    });

  });

  describe("POST /api/auth/avatar (M4 magic-byte validation)", () => {
    it("rejects non-image bytes with a forged image/png mimetype", async () => {
      const signupRes = await request(app)
        .post("/api/auth/signup")
        .send({ name: "Avatar User", email: "avatar@test.com", password: "Password1" });

      const res = await request(app)
        .post("/api/auth/avatar")
        .set("Authorization", `Bearer ${signupRes.body.token}`)
        .attach("avatar", Buffer.from("this is not an image"), {
          filename: "evil.png",
          contentType: "image/png",
        })
        .expect(400);

      expect(res.body.message).toBe("Invalid image file");
    });

    it("rejects SVG content even with a forged image/png mimetype", async () => {
      const signupRes = await request(app)
        .post("/api/auth/signup")
        .send({ name: "Avatar SVG", email: "avatarsvg@test.com", password: "Password1" });

      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
      );
      const res = await request(app)
        .post("/api/auth/avatar")
        .set("Authorization", `Bearer ${signupRes.body.token}`)
        .attach("avatar", svg, {
          filename: "evil.svg",
          contentType: "image/png",
        })
        .expect(400);

      expect(res.body.message).toBe("Invalid image file");
    });

    it("accepts bytes starting with a valid PNG signature", async () => {
      const signupRes = await request(app)
        .post("/api/auth/signup")
        .send({ name: "Avatar PNG", email: "avatarpng@test.com", password: "Password1" });

      const pngBytes = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from("fake-image-body"),
      ]);

      const res = await request(app)
        .post("/api/auth/avatar")
        .set("Authorization", `Bearer ${signupRes.body.token}`)
        .attach("avatar", pngBytes, {
          filename: "avatar.png",
          contentType: "image/png",
        })
        .expect(200);

      expect(res.body.avatarUrl).toMatch(/^data:image\/png;base64,/);
    });
  });
});
