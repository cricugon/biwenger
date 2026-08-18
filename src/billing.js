import { createHash, randomBytes, randomUUID } from "node:crypto";
import Stripe from "stripe";
import { clientError, publicUser } from "./auth.js";
import { config } from "./config.js";
import { db } from "./db.js";

export const STORE_COOKIE = "biwenia_store";
const STORE_SESSION_HOURS = 2;

function product(key, credits, amountCents, priceId, label, description, featured = false) {
  return Object.freeze({ key, credits, amountCents, priceId, label, description, featured });
}

export function billingCatalog() {
  return [
    product("ai_1", 1, 99, config.stripePriceAi1, "1 consulta", "Para probar el analista IA"),
    product("ai_5", 5, 399, config.stripePriceAi5, "5 consultas", "Ahorra 0,96 €", true),
    product("ai_10", 10, 699, config.stripePriceAi10, "10 consultas", "Ahorra 2,91 €")
  ];
}

export function billingConfigured() {
  return Boolean(
    /^sk_(test|live)_/.test(config.stripeSecretKey) &&
    /^whsec_/.test(config.stripeWebhookSecret) &&
    billingCatalog().every(item => /^price_/.test(item.priceId))
  );
}

export function publicCatalog() {
  return billingCatalog().map(({ priceId: _priceId, ...item }) => ({
    ...item,
    price: `${(item.amountCents / 100).toFixed(2).replace(".", ",")} €`
  }));
}

export function catalogProduct(key) {
  const item = billingCatalog().find(entry => entry.key === String(key || ""));
  if (!item) throw clientError("Paquete de consultas no válido");
  return item;
}

let sharedStripe;
export function stripeClient() {
  requireBillingConfigured();
  if (!sharedStripe) sharedStripe = new Stripe(config.stripeSecretKey, { maxNetworkRetries: 2 });
  return sharedStripe;
}

export function requireBillingConfigured() {
  if (!billingConfigured()) throw clientError("La tienda todavía no está disponible", 503);
}

function storeTokenHash(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

function validStoreToken(token) {
  return /^[A-Za-z0-9_-]{40,100}$/.test(String(token || ""));
}

export function cookieValue(header, name = STORE_COOKIE) {
  const prefix = `${name}=`;
  for (const part of String(header || "").split(";")) {
    const value = part.trim();
    if (value.startsWith(prefix)) {
      try { return decodeURIComponent(value.slice(prefix.length)); } catch (_error) { return ""; }
    }
  }
  return "";
}

export async function createStoreSession(userId, options = {}) {
  requireBillingConfigured();
  const database = options.database || await db();
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + STORE_SESSION_HOURS * 3600000);
  await database.collection("store_sessions").insertOne({
    tokenHash: storeTokenHash(token),
    userId,
    createdAt: now,
    lastUsedAt: now,
    expiresAt
  });
  const baseUrl = String(options.baseUrl || config.publicBaseUrl).replace(/\/+$/, "");
  return {
    url: `${baseUrl}/store/access/${encodeURIComponent(token)}`,
    expiresAt: expiresAt.toISOString()
  };
}

export async function authenticateStoreSession(token, options = {}) {
  if (!validStoreToken(token)) return null;
  const database = options.database || await db();
  const now = new Date();
  const session = await database.collection("store_sessions").findOne({
    tokenHash: storeTokenHash(token),
    expiresAt: { $gt: now }
  });
  if (!session) return null;
  const user = await database.collection("users").findOne({ _id: session.userId });
  if (!user) return null;
  database.collection("store_sessions").updateOne(
    { _id: session._id }, { $set: { lastUsedAt: now } }
  ).catch(() => {});
  return { session, user, publicUser: publicUser(user) };
}

export async function storeSummary(token, options = {}) {
  requireBillingConfigured();
  const auth = await authenticateStoreSession(token, options);
  if (!auth) throw clientError("El enlace de compra ha caducado. Vuelve a abrir la tienda desde Biwenia.", 401);
  return { user: auth.publicUser, products: publicCatalog() };
}

export async function createCheckout(token, packKey, options = {}) {
  requireBillingConfigured();
  const database = options.database || await db();
  const stripe = options.stripe || stripeClient();
  const auth = await authenticateStoreSession(token, { database });
  if (!auth) throw clientError("El enlace de compra ha caducado. Vuelve a abrir la tienda desde Biwenia.", 401);
  const selected = catalogProduct(packKey);
  const orderId = randomUUID();
  const now = new Date();
  const order = {
    orderId,
    userId: auth.user._id,
    email: auth.user.email,
    packKey: selected.key,
    credits: selected.credits,
    amountCents: selected.amountCents,
    currency: "eur",
    stripePriceId: selected.priceId,
    status: "creating",
    createdAt: now,
    updatedAt: now
  };
  await database.collection("billing_orders").insertOne(order);
  try {
    const baseUrl = String(options.baseUrl || config.publicBaseUrl).replace(/\/+$/, "");
    const checkout = await stripe.checkout.sessions.create({
      mode: "payment",
      locale: "es",
      customer_email: auth.user.email,
      line_items: [{ price: selected.priceId, quantity: 1 }],
      success_url: `${baseUrl}/store/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/store?cancelled=1`,
      expires_at: Math.floor(Date.now() / 1000) + 1800,
      metadata: {
        orderId,
        packKey: selected.key,
        creditQuantity: String(selected.credits)
      },
      payment_intent_data: {
        metadata: { orderId, packKey: selected.key, creditQuantity: String(selected.credits) }
      }
    }, { idempotencyKey: `biwenia-checkout-${orderId}` });
    if (!checkout || !checkout.id || !checkout.url) throw new Error("Stripe no devolvió una sesión de pago válida");
    await database.collection("billing_orders").updateOne({ orderId }, { $set: {
      stripeSessionId: checkout.id,
      checkoutUrl: checkout.url,
      status: "pending",
      updatedAt: new Date()
    } });
    return { orderId, sessionId: checkout.id, url: checkout.url };
  } catch (error) {
    await database.collection("billing_orders").updateOne({ orderId }, { $set: {
      status: "creation_failed",
      error: String(error && error.message || "Error de Stripe").slice(0, 300),
      updatedAt: new Date()
    } });
    throw error;
  }
}

export async function constructAndProcessWebhook(payload, signature, options = {}) {
  requireBillingConfigured();
  const stripe = options.stripe || stripeClient();
  let event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, config.stripeWebhookSecret);
  } catch (_error) {
    throw clientError("Firma de webhook no válida", 400);
  }
  return processStripeEvent(event, options);
}

export async function processStripeEvent(event, options = {}) {
  const database = options.database || await db();
  const type = String(event && event.type || "");
  const session = event && event.data && event.data.object;
  if (!session || !session.id) return { received: true, handled: false };
  if (type === "checkout.session.completed") {
    if (session.payment_status !== "paid") return { received: true, handled: true, pending: true };
    return fulfillCheckout(session, event.id, { database });
  }
  if (type === "checkout.session.async_payment_succeeded") {
    return fulfillCheckout(session, event.id, { database });
  }
  if (type === "checkout.session.async_payment_failed" || type === "checkout.session.expired") {
    await database.collection("billing_orders").updateOne(
      { stripeSessionId: session.id, status: { $nin: ["fulfilled"] } },
      { $set: { status: type.endsWith("expired") ? "expired" : "payment_failed", updatedAt: new Date() },
        $addToSet: { stripeEventIds: String(event.id || "") } }
    );
    return { received: true, handled: true };
  }
  return { received: true, handled: false };
}

export async function fulfillCheckout(session, eventId, options = {}) {
  const database = options.database || await db();
  const orders = database.collection("billing_orders");
  let order = await orders.findOne({ stripeSessionId: session.id });
  if (!order && session.metadata && session.metadata.orderId) {
    order = await orders.findOne({ orderId: String(session.metadata.orderId) });
  }
  if (!order) throw clientError("Compra de Stripe no reconocida", 400);
  if (session.payment_status && session.payment_status !== "paid") {
    throw clientError("El pago todavía no está confirmado", 409);
  }
  if (String(session.currency || "").toLowerCase() !== order.currency || Number(session.amount_total) !== order.amountCents) {
    throw clientError("El importe confirmado por Stripe no coincide", 400);
  }
  if (session.metadata && session.metadata.orderId && String(session.metadata.orderId) !== order.orderId) {
    throw clientError("La referencia de la compra no coincide", 400);
  }
  const users = database.collection("users");
  const creditedUser = await users.findOneAndUpdate(
    { _id: order.userId, creditedStripeSessions: { $ne: session.id } },
    {
      $inc: { "credits.balance": order.credits },
      $addToSet: { creditedStripeSessions: session.id },
      $set: { "credits.unlimited": false, updatedAt: new Date() }
    },
    { returnDocument: "after" }
  );
  let user = creditedUser;
  if (!user) {
    user = await users.findOne({ _id: order.userId });
    if (!user) throw clientError("El usuario de la compra ya no existe", 404);
    if (!Array.isArray(user.creditedStripeSessions) || !user.creditedStripeSessions.includes(session.id)) {
      throw new Error("No se pudo acreditar la compra");
    }
  }
  await orders.updateOne({ orderId: order.orderId }, {
    $set: {
      stripeSessionId: session.id,
      stripePaymentIntentId: String(session.payment_intent || ""),
      status: "fulfilled",
      fulfilledAt: order.fulfilledAt || new Date(),
      updatedAt: new Date()
    },
    $addToSet: { stripeEventIds: String(eventId || "") }
  });
  return {
    received: true,
    handled: true,
    fulfilled: Boolean(creditedUser),
    duplicate: !creditedUser,
    credits: publicUser(user).credits
  };
}

export async function purchaseStatus(token, stripeSessionId, options = {}) {
  const database = options.database || await db();
  const auth = await authenticateStoreSession(token, { database });
  if (!auth) throw clientError("El enlace de compra ha caducado. El saldo seguirá abonándose en tu cuenta.", 401);
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(String(stripeSessionId || ""))) {
    throw clientError("Referencia de compra no válida");
  }
  const order = await database.collection("billing_orders").findOne({
    stripeSessionId: String(stripeSessionId),
    userId: auth.user._id
  });
  if (!order) throw clientError("Compra no encontrada", 404);
  const freshUser = await database.collection("users").findOne({ _id: auth.user._id });
  return {
    orderId: order.orderId,
    status: order.status,
    creditsPurchased: order.credits,
    credits: publicUser(freshUser || auth.user).credits
  };
}

export async function verifyStripeCatalog(options = {}) {
  requireBillingConfigured();
  const stripe = options.stripe || stripeClient();
  const verified = [];
  for (const item of billingCatalog()) {
    const price = await stripe.prices.retrieve(item.priceId);
    verified.push({
      key: item.key,
      active: Boolean(price.active),
      currency: String(price.currency || "").toLowerCase(),
      amountCents: Number(price.unit_amount),
      valid: Boolean(price.active) && String(price.currency).toLowerCase() === "eur" &&
        Number(price.unit_amount) === item.amountCents && price.type === "one_time"
    });
  }
  return verified;
}
