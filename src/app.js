import express from "express";
import { config } from "./config.js";
import { db } from "./db.js";
import { queryValues, storeBiwengerObservations } from "./repository.js";
import { madridParts, normalizeName } from "./utils.js";

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

const observationWindows = new Map();
function observationRateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip || "unknown";
  const current = observationWindows.get(key);
  if (!current || now - current.startedAt > 3600000) {
    observationWindows.set(key, { startedAt: now, count: 1 });
    return next();
  }
  current.count += 1;
  if (current.count > 10) return res.status(429).json({ error: "Demasiados envíos; inténtalo más tarde" });
  next();
}

app.get("/health", async (_req, res, next) => {
  try {
    const database = await db();
    await database.command({ ping: 1 });
    res.json({ ok: true, service: "biwenger-market-values", time: new Date().toISOString() });
  } catch (error) { next(error); }
});

app.post("/api/v1/values/query", async (req, res, next) => {
  try {
    const requested = Array.isArray(req.body && req.body.players) ? req.body.players : [];
    const days = Math.min(365, Math.max(7, Number(req.body && req.body.days) || 60));
    if (!requested.some(item => normalizeName(typeof item === "string" ? item : item && item.name))) {
      return res.status(400).json({ error: "Debes indicar al menos un futbolista" });
    }
    const players = await queryValues(requested, days);
    res.json({
      version: 2,
      source: "Biwenger Saldo Values",
      sourceUrl: `${req.protocol}://${req.get("host")}`,
      sourceUpdatedAt: madridParts().date,
      fetchedAt: new Date().toISOString(),
      players
    });
  } catch (error) { next(error); }
});

app.post("/api/v1/observations/biwenger", observationRateLimit, async (req, res, next) => {
  try {
    if (config.ingestApiKey && req.get("x-ingest-key") !== config.ingestApiKey) {
      return res.status(401).json({ error: "Clave de ingestión incorrecta" });
    }
    const body = req.body || {};
    const madrid = madridParts();
    if (madrid.hour < 7 || body.observedDate !== madrid.date) {
      return res.status(400).json({ error: "Solo se aceptan observaciones del día actual después de las 07:00 de Madrid" });
    }
    if (!/^[a-f0-9-]{20,64}$/i.test(String(body.clientId || ""))) {
      return res.status(400).json({ error: "Identificador de cliente inválido" });
    }
    const players = Array.isArray(body.players) ? body.players.slice(0, 1000) : [];
    if (players.length < 50) return res.status(400).json({ error: "El catálogo está incompleto" });
    const result = await storeBiwengerObservations({
      observedDate: body.observedDate,
      observedAt: body.observedAt,
      clientId: String(body.clientId),
      players
    });
    res.status(201).json({ ok: true, ...result });
  } catch (error) { next(error); }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: process.env.NODE_ENV === "production" ? "Error interno" : error.message });
});

app.listen(config.port, "0.0.0.0", () => {
  console.log(`Biwenger market values escuchando en 0.0.0.0:${config.port}`);
});
