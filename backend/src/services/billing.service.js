const stripe = require("../config/stripe");

const createCheckoutSession = async (user) => {
  let stripeCustomerId = user.stripeCustomerId;

  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { userId: user._id.toString() },
    });
    stripeCustomerId = customer.id;
    user.stripeCustomerId = stripeCustomerId;
    await user.save();
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
    success_url: `${process.env.FRONTEND_URL}/settings?upgraded=true`,
    cancel_url: `${process.env.FRONTEND_URL}/settings?upgraded=false`,
    client_reference_id: user._id.toString(),
    customer: stripeCustomerId,
  });

  return { url: session.url };
};

const createPortalSession = async (user) => {
  if (!user.stripeCustomerId) {
    const error = new Error("No Stripe customer found for this account");
    error.status = 400;
    throw error;
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${process.env.FRONTEND_URL}/settings`,
  });

  return { url: session.url };
};

module.exports = { createCheckoutSession, createPortalSession };
