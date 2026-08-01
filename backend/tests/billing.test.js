jest.mock("../src/config/stripe", () => ({
  customers: {
    create: jest.fn(),
  },
  checkout: {
    sessions: {
      create: jest.fn(),
    },
  },
  billingPortal: {
    sessions: {
      create: jest.fn(),
    },
  },
  webhooks: {
    constructEvent: jest.fn(),
  },
}));

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../src/server");
const User = require("../src/models/User");
const stripe = require("../src/config/stripe");
const { connect, clearCollections } = require("./setup");

const tokenFor = (userId) => {
  return jwt.sign({ id: userId.toString(), jti: crypto.randomUUID() }, process.env.JWT_SECRET);
};

const createUser = async (overrides = {}) => {
  return User.create({ name: "Test User", email: "test@test.com", passwordHash: "x", ...overrides });
};

let mockEvent;
let mockEventError;

beforeAll(async () => await connect());
afterEach(async () => {
  await clearCollections();
  jest.clearAllMocks();
  jest.restoreAllMocks();
  mockEvent = null;
  mockEventError = null;
});

describe("Billing", () => {
  describe("GET /api/billing/plan", () => {
    it("returns 401 without a token", async () => {
      const res = await request(app).get("/api/billing/plan");
      expect(res.status).toBe(401);
    });

    it("returns plan and planStatus", async () => {
      const user = await createUser();
      const res = await request(app)
        .get("/api/billing/plan")
        .set("Authorization", `Bearer ${tokenFor(user._id)}`)
        .expect(200);

      expect(res.body.plan).toBe("free");
      expect(res.body.planStatus).toBe("active");
    });
  });

  describe("POST /api/billing/upgrade", () => {
    it("creates a Stripe customer and returns a Checkout URL", async () => {
      stripe.customers.create.mockResolvedValue({ id: "cus_test" });
      stripe.checkout.sessions.create.mockResolvedValue({
        url: "https://checkout.stripe.com/c/pay/test",
      });

      const user = await createUser();

      const res = await request(app)
        .post("/api/billing/upgrade")
        .set("Authorization", `Bearer ${tokenFor(user._id)}`)
        .expect(200);

      expect(res.body).toEqual({ url: "https://checkout.stripe.com/c/pay/test" });
      expect(stripe.customers.create).toHaveBeenCalledWith({
        email: "test@test.com",
        metadata: { userId: user._id.toString() },
      });

      const updated = await User.findById(user._id);
      expect(updated.stripeCustomerId).toBe("cus_test");

      expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "subscription",
          line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
          client_reference_id: user._id.toString(),
          customer: "cus_test",
        })
      );
    });

    it("reuses an existing Stripe customer on second upgrade", async () => {
      stripe.checkout.sessions.create.mockResolvedValue({ url: "https://checkout.stripe.com/c/pay/2" });

      const user = await createUser({ stripeCustomerId: "cus_existing" });

      await request(app)
        .post("/api/billing/upgrade")
        .set("Authorization", `Bearer ${tokenFor(user._id)}`)
        .expect(200);

      expect(stripe.customers.create).not.toHaveBeenCalled();
      expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ customer: "cus_existing" })
      );
    });
  });

  describe("POST /api/billing/portal", () => {
    it("returns 400 when user has no Stripe customer", async () => {
      const user = await createUser();
      const res = await request(app)
        .post("/api/billing/portal")
        .set("Authorization", `Bearer ${tokenFor(user._id)}`)
        .expect(400);

      expect(res.body.message).toBe("No Stripe customer found for this account");
    });

    it("returns a Portal URL when user has a Stripe customer", async () => {
      stripe.billingPortal.sessions.create.mockResolvedValue({
        url: "https://billing.stripe.com/p/session/test",
      });

      const user = await createUser({ stripeCustomerId: "cus_test" });

      const res = await request(app)
        .post("/api/billing/portal")
        .set("Authorization", `Bearer ${tokenFor(user._id)}`)
        .expect(200);

      expect(res.body).toEqual({ url: "https://billing.stripe.com/p/session/test" });
      expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
        customer: "cus_test",
        return_url: `${process.env.FRONTEND_URL}/settings`,
      });
    });
  });

  describe("POST /api/billing/webhook", () => {
    it("returns 400 when signature verification fails", async () => {
      mockEventError = new Error("No signatures found");
      stripe.webhooks.constructEvent.mockImplementation(() => {
        throw mockEventError;
      });

      const res = await request(app)
        .post("/api/billing/webhook")
        .set("stripe-signature", "bad")
        .send({ type: "invoice.payment_failed" })
        .expect(400);

      expect(res.text).toMatch(/No signatures found/);
    });

    it("sets plan to pro on checkout.session.completed", async () => {
      const user = await createUser({ stripeCustomerId: "cus_test" });

      mockEvent = {
        type: "checkout.session.completed",
        data: {
          object: {
            client_reference_id: user._id.toString(),
            customer: "cus_test",
            subscription: "sub_test",
          },
        },
      };
      stripe.webhooks.constructEvent.mockImplementation(() => mockEvent);

      await request(app)
        .post("/api/billing/webhook")
        .set("stripe-signature", "valid")
        .send({})
        .expect(200);

      const updated = await User.findById(user._id);
      expect(updated.plan).toBe("pro");
      expect(updated.planStatus).toBe("active");
      expect(updated.stripeSubscriptionId).toBe("sub_test");
    });

    it("sets planStatus past_due on invoice.payment_failed without downgrading plan", async () => {
      const user = await createUser({ stripeCustomerId: "cus_test", plan: "pro", planStatus: "active" });

      mockEvent = {
        type: "invoice.payment_failed",
        data: { object: { customer: "cus_test" } },
      };
      stripe.webhooks.constructEvent.mockImplementation(() => mockEvent);

      await request(app)
        .post("/api/billing/webhook")
        .set("stripe-signature", "valid")
        .send({})
        .expect(200);

      const updated = await User.findById(user._id);
      expect(updated.planStatus).toBe("past_due");
      expect(updated.plan).toBe("pro");
    });

    it("stores the renewal date on customer.subscription.updated", async () => {
      const user = await createUser({ stripeCustomerId: "cus_test", plan: "pro", planStatus: "active" });

      mockEvent = {
        type: "customer.subscription.updated",
        data: {
          object: {
            customer: "cus_test",
            id: "sub_test",
            status: "active",
            current_period_end: 1800000000,
          },
        },
      };
      stripe.webhooks.constructEvent.mockImplementation(() => mockEvent);

      await request(app)
        .post("/api/billing/webhook")
        .set("stripe-signature", "valid")
        .send({})
        .expect(200);

      const updated = await User.findById(user._id);
      expect(updated.planStatus).toBe("active");
      expect(updated.plan).toBe("pro");
      expect(updated.stripeSubscriptionEndsAt).toEqual(new Date(1800000000 * 1000));
    });

    it("downgrades to free and clears subscription on customer.subscription.deleted", async () => {
      const user = await createUser({
        stripeCustomerId: "cus_test",
        stripeSubscriptionId: "sub_test",
        stripeSubscriptionEndsAt: new Date(1800000000 * 1000),
        plan: "pro",
        planStatus: "active",
      });

      mockEvent = {
        type: "customer.subscription.deleted",
        data: { object: { customer: "cus_test", id: "sub_test" } },
      };
      stripe.webhooks.constructEvent.mockImplementation(() => mockEvent);

      await request(app)
        .post("/api/billing/webhook")
        .set("stripe-signature", "valid")
        .send({})
        .expect(200);

      const updated = await User.findById(user._id);
      expect(updated.plan).toBe("free");
      expect(updated.planStatus).toBe("canceled");
      expect(updated.stripeSubscriptionId).toBeNull();
      expect(updated.stripeSubscriptionEndsAt).toBeNull();
    });

    it("responds 200 and logs a warning when no user matches the customer", async () => {
      mockEvent = {
        type: "invoice.payment_failed",
        data: { object: { customer: "cus_unknown" } },
      };
      stripe.webhooks.constructEvent.mockImplementation(() => mockEvent);

      const res = await request(app)
        .post("/api/billing/webhook")
        .set("stripe-signature", "valid")
        .send({})
        .expect(200);

      expect(res.body.received).toBe(true);
    });

    it("returns 500 when a handler throws so Stripe retries the event", async () => {
      const user = await createUser({ stripeCustomerId: "cus_test" });

      mockEvent = {
        type: "checkout.session.completed",
        data: {
          object: {
            client_reference_id: user._id.toString(),
            customer: "cus_test",
            subscription: "sub_test",
          },
        },
      };
      stripe.webhooks.constructEvent.mockImplementation(() => mockEvent);

      jest.spyOn(User, "findById").mockRejectedValueOnce(new Error("db connection lost"));

      const res = await request(app)
        .post("/api/billing/webhook")
        .set("stripe-signature", "valid")
        .send({})
        .expect(500);

      expect(res.text).toBe("Webhook processing failed");
    });
  });

  describe("Generic 500 responses (no error.message leak)", () => {
    it("returns generic message when the plan endpoint fails", async () => {
      const user = await createUser();
      jest.spyOn(User, "findById").mockRejectedValueOnce(new Error("plan db secret"));

      const res = await request(app)
        .get("/api/billing/plan")
        .set("Authorization", `Bearer ${tokenFor(user._id)}`)
        .expect(500);

      expect(res.body.message).toBe("Something went wrong");
      expect(JSON.stringify(res.body)).not.toContain("plan db secret");
    });

    it("returns generic message when upgrade fails", async () => {
      stripe.customers.create.mockRejectedValue(new Error("stripe api secret"));

      const user = await createUser();
      const res = await request(app)
        .post("/api/billing/upgrade")
        .set("Authorization", `Bearer ${tokenFor(user._id)}`)
        .expect(500);

      expect(res.body.message).toBe("Something went wrong");
      expect(JSON.stringify(res.body)).not.toContain("stripe api secret");
    });

    it("returns generic message for unexpected portal failures", async () => {
      stripe.billingPortal.sessions.create.mockRejectedValue(new Error("portal secret boom"));

      const user = await createUser({ stripeCustomerId: "cus_test" });
      const res = await request(app)
        .post("/api/billing/portal")
        .set("Authorization", `Bearer ${tokenFor(user._id)}`)
        .expect(500);

      expect(res.body.message).toBe("Something went wrong");
      expect(JSON.stringify(res.body)).not.toContain("portal secret");
    });
  });
});
