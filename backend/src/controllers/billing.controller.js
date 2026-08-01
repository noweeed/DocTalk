const User = require("../models/User");
const Document = require("../models/Document");
const planLimits = require("../config/planLimits");
const stripe = require("../config/stripe");
const {
  createCheckoutSession,
  createPortalSession,
} = require("../services/billing.service");

const getPlan = async (req, res) => {
  try {
    const userDoc = req.userDoc || (await User.findById(req.user.id));

    if (!userDoc) {
      return res.status(404).json({ message: "User not found" });
    }

    const limits = planLimits[userDoc.plan];
    const docCount = await Document.countDocuments({
      userId: req.user.id,
      isTrashed: false,
    });

    res.status(200).json({
      plan: userDoc.plan,
      planStatus: userDoc.planStatus,
      limits,
      usage: {
        documents: docCount,
        questionsThisMonth: userDoc.questionsUsedThisMonth,
        usageResetAt: userDoc.usageResetAt,
      },
    });
  } catch (error) {
    console.error("[billing.controller]", error);
    res.status(500).json({ message: "Something went wrong" });
  }
};

const upgrade = async (req, res) => {
  try {
    const userDoc = req.userDoc || (await User.findById(req.user.id));

    if (!userDoc) {
      return res.status(404).json({ message: "User not found" });
    }

    const { url } = await createCheckoutSession(userDoc);

    res.status(200).json({ url });
  } catch (error) {
    console.error("[billing.controller]", error);
    res.status(500).json({ message: "Something went wrong" });
  }
};

const portal = async (req, res) => {
  try {
    const userDoc = req.userDoc || (await User.findById(req.user.id));

    if (!userDoc) {
      return res.status(404).json({ message: "User not found" });
    }

    const { url } = await createPortalSession(userDoc);

    res.status(200).json({ url });
  } catch (error) {
    const status = error.status || 500;
    console.error("[billing.controller]", error);
    res.status(status).json({
      message: status >= 500 ? "Something went wrong" : error.message,
    });
  }
};

const findUserByStripeCustomerId = (stripeCustomerId) => {
  if (!stripeCustomerId) return null;
  return User.findOne({ stripeCustomerId });
};

const handleCheckoutCompleted = async (session) => {
  let user = await User.findById(session.client_reference_id);
  if (!user) {
    user = await findUserByStripeCustomerId(session.customer);
  }

  if (!user) {
    console.warn(
      `[billing] No user found for checkout.session.completed (client_reference_id: ${session.client_reference_id})`
    );
    return;
  }

  user.stripeCustomerId = session.customer;
  user.stripeSubscriptionId = session.subscription;
  user.plan = "pro";
  user.planStatus = "active";
  await user.save();
};

const handleSubscriptionCreated = async (subscription) => {
  const user = await findUserByStripeCustomerId(subscription.customer);

  if (!user) {
    console.warn(
      `[billing] No user found for customer.subscription.created (customer: ${subscription.customer})`
    );
    return;
  }

  user.stripeSubscriptionId = subscription.id;
  user.planStatus = subscription.status;
  user.stripeSubscriptionEndsAt = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000)
    : null;
  await user.save();
};

const handleSubscriptionUpdated = async (subscription) => {
  const user = await findUserByStripeCustomerId(subscription.customer);

  if (!user) {
    console.warn(
      `[billing] No user found for customer.subscription.updated (customer: ${subscription.customer})`
    );
    return;
  }

  user.planStatus = subscription.status;
  user.plan = ["active", "trialing"].includes(subscription.status) ? "pro" : "free";
  user.stripeSubscriptionEndsAt = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000)
    : null;
  await user.save();
};

const handleSubscriptionDeleted = async (subscription) => {
  const user = await findUserByStripeCustomerId(subscription.customer);

  if (!user) {
    console.warn(
      `[billing] No user found for customer.subscription.deleted (customer: ${subscription.customer})`
    );
    return;
  }

  user.plan = "free";
  user.planStatus = "canceled";
  user.stripeSubscriptionId = null;
  user.stripeSubscriptionEndsAt = null;
  await user.save();
};

const handleInvoicePaymentSucceeded = async (invoice) => {
  const user = await findUserByStripeCustomerId(invoice.customer);

  if (!user) {
    console.warn(
      `[billing] No user found for invoice.payment_succeeded (customer: ${invoice.customer})`
    );
    return;
  }

  user.planStatus = "active";
  await user.save();
};

const handleInvoicePaymentFailed = async (invoice) => {
  const user = await findUserByStripeCustomerId(invoice.customer);

  if (!user) {
    console.warn(
      `[billing] No user found for invoice.payment_failed (customer: ${invoice.customer})`
    );
    return;
  }

  user.planStatus = "past_due";
  await user.save();
};

const handleWebhook = async (req, res) => {
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (error) {
    console.error("[billing] Webhook signature verification failed:", error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object);
        break;
      case "customer.subscription.created":
        await handleSubscriptionCreated(event.data.object);
        break;
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event.data.object);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object);
        break;
      case "invoice.payment_succeeded":
        await handleInvoicePaymentSucceeded(event.data.object);
        break;
      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(event.data.object);
        break;
      default:
        console.log(`[billing] Unhandled webhook event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    // Unexpected exception during event handling → 500 so Stripe retries the
    // delivery. Expected no-op cases (e.g. no user matches the customer) are
    // logged as warnings by the handlers and return normally, so they still
    // reach res.json() above and are acknowledged with 200.
    console.error(`[billing] Error handling webhook event ${event.type}:`, error.message);
    res.status(500).send("Webhook processing failed");
  }
};

module.exports = { getPlan, upgrade, portal, handleWebhook };
