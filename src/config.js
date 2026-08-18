export const config = Object.freeze({
  port: Number.parseInt(process.env.PORT || "3000", 10),
  mongoUri: process.env.MONGODB_URI || "",
  mongoDb: process.env.MONGODB_DB || "biwenger_market",
  fantasyUrl: (process.env.FANTASY_URL || "https://www.futbolfantasy.com/analytics/biwenger/mercado").replace(/\/+$/, ""),
  detailDelayMs: Math.max(250, Number.parseInt(process.env.DETAIL_DELAY_MS || "900", 10)),
  sessionDays: Math.min(365, Math.max(1, Number.parseInt(process.env.SESSION_DAYS || "90", 10))),
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-5.6-sol",
  openaiReasoningEffort: process.env.OPENAI_REASONING_EFFORT || "medium",
  openaiMaxOutputTokens: Math.min(4000, Math.max(300, Number.parseInt(process.env.OPENAI_MAX_OUTPUT_TOKENS || "1200", 10))),
  openaiContextMaxChars: Math.min(600000, Math.max(50000, Number.parseInt(process.env.OPENAI_CONTEXT_MAX_CHARS || "240000", 10))),
  openaiSafetySalt: process.env.OPENAI_SAFETY_SALT || "biwenger-saldo",
  datasetHashSalt: process.env.DATASET_HASH_SALT || process.env.OPENAI_SAFETY_SALT || "biwenger-dataset",
  adminUsername: process.env.ADMIN_USERNAME || "admin",
  adminPassword: process.env.ADMIN_PASSWORD || "",
  adminSessionSecret: process.env.ADMIN_SESSION_SECRET || process.env.DATASET_HASH_SALT || process.env.OPENAI_SAFETY_SALT || "",
  adminSessionHours: Math.min(168, Math.max(1, Number.parseInt(process.env.ADMIN_SESSION_HOURS || "12", 10))),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || "https://biwenger.onrender.com").replace(/\/+$/, ""),
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
  stripePriceAi1: process.env.STRIPE_PRICE_AI_1 || "price_1U5ryjL6o7qmQamsEcFG1KK4",
  stripePriceAi5: process.env.STRIPE_PRICE_AI_5 || "price_1U5rz7L6o7qmQamsynUSY96v",
  stripePriceAi10: process.env.STRIPE_PRICE_AI_10 || "price_1U5rzJL6o7qmQamsy3j8nkKT"
});

export function requireMongoUri() {
  if (!config.mongoUri) throw new Error("Falta la variable de entorno MONGODB_URI");
  return config.mongoUri;
}
