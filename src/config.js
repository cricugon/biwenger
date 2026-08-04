export const config = Object.freeze({
  port: Number.parseInt(process.env.PORT || "3000", 10),
  mongoUri: process.env.MONGODB_URI || "",
  mongoDb: process.env.MONGODB_DB || "biwenger_market",
  fantasyUrl: (process.env.FANTASY_URL || "https://www.futbolfantasy.com/analytics/biwenger/mercado").replace(/\/+$/, ""),
  detailDelayMs: Math.max(250, Number.parseInt(process.env.DETAIL_DELAY_MS || "900", 10)),
  ingestApiKey: process.env.INGEST_API_KEY || ""
});

export function requireMongoUri() {
  if (!config.mongoUri) throw new Error("Falta la variable de entorno MONGODB_URI");
  return config.mongoUri;
}
