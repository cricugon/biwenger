import "dotenv/config";
import { config } from "../src/config.js";
import { verifyStripeCatalog } from "../src/billing.js";

const prices = await verifyStripeCatalog();
console.log(JSON.stringify({
  liveKey: config.stripeSecretKey.startsWith("sk_live_"),
  webhookConfigured: config.stripeWebhookSecret.startsWith("whsec_"),
  prices
}, null, 2));
if (!prices.every(price => price.valid)) process.exitCode = 2;
