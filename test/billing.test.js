import test from "node:test";
import assert from "node:assert/strict";
import { catalogProduct, fulfillCheckout, publicCatalog } from "../src/billing.js";

function billingDatabase() {
  const user = {
    _id: "user-1",
    email: "persona@example.com",
    displayName: "Ana",
    credits: { unlimited: false, balance: 2 },
    creditedStripeSessions: []
  };
  const order = {
    orderId: "order-1",
    userId: user._id,
    packKey: "ai_5",
    credits: 5,
    amountCents: 399,
    currency: "eur",
    stripeSessionId: "cs_live_example",
    status: "pending"
  };
  const collections = {
    billing_orders: {
      async findOne(query) {
        if (query.stripeSessionId === order.stripeSessionId || query.orderId === order.orderId) return order;
        return null;
      },
      async updateOne(_query, update) {
        Object.assign(order, update.$set || {});
        if (update.$addToSet && update.$addToSet.stripeEventIds && !order.stripeEventIds?.includes(update.$addToSet.stripeEventIds)) {
          order.stripeEventIds = [...(order.stripeEventIds || []), update.$addToSet.stripeEventIds];
        }
        return { modifiedCount: 1 };
      }
    },
    users: {
      async findOneAndUpdate(query, update) {
        if (query._id !== user._id || user.creditedStripeSessions.includes(order.stripeSessionId)) return null;
        user.credits.balance += update.$inc["credits.balance"];
        user.credits.unlimited = false;
        user.creditedStripeSessions.push(update.$addToSet.creditedStripeSessions);
        return user;
      },
      async findOne(query) { return query._id === user._id ? user : null; }
    }
  };
  return { database: { collection: name => collections[name] }, user, order };
}

test("publica los tres paquetes sin exponer identificadores de Stripe", () => {
  const products = publicCatalog();
  assert.deepEqual(products.map(item => [item.key, item.credits, item.amountCents]), [
    ["ai_1", 1, 99], ["ai_5", 5, 399], ["ai_10", 10, 699]
  ]);
  assert.equal(products.some(item => "priceId" in item), false);
  assert.equal(catalogProduct("ai_10").credits, 10);
  assert.throws(() => catalogProduct("inventado"), /no válido/);
});

test("acredita una compra confirmada exactamente una vez", async () => {
  const fixture = billingDatabase();
  const session = {
    id: "cs_live_example",
    payment_status: "paid",
    currency: "eur",
    amount_total: 399,
    payment_intent: "pi_example",
    metadata: { orderId: "order-1" }
  };
  const first = await fulfillCheckout(session, "evt_first", { database: fixture.database });
  const repeated = await fulfillCheckout(session, "evt_repeated", { database: fixture.database });
  assert.equal(first.fulfilled, true);
  assert.equal(repeated.duplicate, true);
  assert.equal(fixture.user.credits.balance, 7);
  assert.equal(fixture.order.status, "fulfilled");
});

test("rechaza una confirmación con importe distinto", async () => {
  const fixture = billingDatabase();
  await assert.rejects(() => fulfillCheckout({
    id: "cs_live_example",
    payment_status: "paid",
    currency: "eur",
    amount_total: 398,
    metadata: { orderId: "order-1" }
  }, "evt_wrong", { database: fixture.database }), /importe/);
  assert.equal(fixture.user.credits.balance, 2);
});
