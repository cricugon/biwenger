import "dotenv/config";
import { fileURLToPath, pathToFileURL } from "node:url";
import express from "express";
import { config } from "./config.js";
import { db } from "./db.js";
import {
  authenticateToken,
  bearerToken,
  clientError,
  loginUser,
  refundAiCredit,
  registerUser,
  reserveAiCredit,
  revokeToken
} from "./auth.js";
import { askBiwengerAi, validateAiInput } from "./ai.js";
import { storePredictionDataset } from "./dataset.js";
import { storeDiagnosticDump } from "./diagnostics.js";
import { queryValues, storeBiwengerObservations } from "./repository.js";
import { madridParts, normalizeName } from "./utils.js";
import {
  adminConfigured,
  adminConfigurationProblems,
  adminDiagnostic,
  adminDiagnostics,
  adminLogin,
  adminLogout,
  adminMarketValues,
  adminSummary,
  adminUsers,
  deleteUser,
  requireAdmin,
  updateUserCredits
} from "./admin.js";

const publicDirectory = fileURLToPath(new URL("../public", import.meta.url));

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(express.json({ limit: "8mb" }));

  const observationRateLimit = rateLimit({ limit: 10, windowMs: 3600000, key: req => req.ip || "unknown" });
  const authRateLimit = rateLimit({ limit: 20, windowMs: 15 * 60000, key: req => req.ip || "unknown" });
  const aiRateLimit = rateLimit({ limit: 30, windowMs: 3600000, key: req => String(req.auth && req.auth.user._id || req.ip || "unknown") });
  const datasetRateLimit = rateLimit({ limit: 60, windowMs: 3600000, key: req => String(req.auth && req.auth.user._id || req.ip || "unknown") });
  const adminLoginRateLimit = rateLimit({ limit: 10, windowMs: 15 * 60000, key: req => req.ip || "unknown" });

  app.use("/admin/assets", express.static(`${publicDirectory}/admin`, { maxAge: "1h", index: false }));
  app.get(["/admin", "/admin/"], (_req, res) => res.sendFile(`${publicDirectory}/admin/index.html`));

  app.post("/admin/api/login", adminLoginRateLimit, (req, res, next) => {
    try { res.json(adminLogin(req, res)); } catch (error) { next(error); }
  });
  app.get("/admin/api/config", (_req, res) => {
    const problems = adminConfigurationProblems();
    res.setHeader("Cache-Control", "no-store");
    res.json({ configured: problems.length === 0, requirements: problems.length ? problems : ["ok"] });
  });
  app.post("/admin/api/logout", requireAdmin, (req, res, next) => {
    try { res.json(adminLogout(req, res)); } catch (error) { next(error); }
  });
  app.get("/admin/api/session", requireAdmin, (_req, res) => res.json({ ok: true, username: config.adminUsername }));
  app.get("/admin/api/summary", requireAdmin, async (_req, res, next) => {
    try { res.json(await adminSummary()); } catch (error) { next(error); }
  });
  app.get("/admin/api/users", requireAdmin, async (req, res, next) => {
    try { res.json({ users: await adminUsers(req.query) }); } catch (error) { next(error); }
  });
  app.patch("/admin/api/users/:id/credits", requireAdmin, async (req, res, next) => {
    try { res.json(await updateUserCredits(req.params.id, req.body)); } catch (error) { next(error); }
  });
  app.delete("/admin/api/users/:id", requireAdmin, async (req, res, next) => {
    try { res.json(await deleteUser(req.params.id)); } catch (error) { next(error); }
  });
  app.get("/admin/api/market-values", requireAdmin, async (req, res, next) => {
    try { res.json(await adminMarketValues(req.query)); } catch (error) { next(error); }
  });
  app.get("/admin/api/diagnostics", requireAdmin, async (req, res, next) => {
    try { res.json({ diagnostics: await adminDiagnostics(req.query) }); } catch (error) { next(error); }
  });
  app.get("/admin/api/diagnostics/:id", requireAdmin, async (req, res, next) => {
    try { res.json(await adminDiagnostic(req.params.id)); } catch (error) { next(error); }
  });

  app.get("/health", async (_req, res, next) => {
    try {
      const database = await db();
      await database.command({ ping: 1 });
      res.json({
        ok: true,
        service: "biwenger-market-values",
        time: new Date().toISOString(),
        features: { accounts: true, ai: Boolean(config.openaiApiKey), predictionDataset: true, admin: adminConfigured(), diagnostics: true }
      });
    } catch (error) { next(error); }
  });

  app.post("/api/v1/auth/register", authRateLimit, async (req, res, next) => {
    try {
      const session = await registerUser(req.body || {});
      res.status(201).json(session);
    } catch (error) { next(error); }
  });

  app.post("/api/v1/auth/login", authRateLimit, async (req, res, next) => {
    try {
      res.json(await loginUser(req.body || {}));
    } catch (error) { next(error); }
  });

  app.get("/api/v1/auth/me", requireAuth, (req, res) => {
    res.json({ user: req.auth.publicUser });
  });

  app.post("/api/v1/auth/logout", requireAuth, async (req, res, next) => {
    try {
      await revokeToken(req.authToken);
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  app.post("/api/v1/ai/ask", requireAuth, aiRateLimit, async (req, res, next) => {
    let requestId;
    let creditReserved = false;
    try {
      const input = validateAiInput(req.body || {});
      const database = await db();
      const credits = await reserveAiCredit(req.auth.user._id);
      creditReserved = true;
      const createdAt = new Date();
      const inserted = await database.collection("ai_requests").insertOne({
        userId: req.auth.user._id,
        preset: input.preset,
        question: input.question,
        status: "started",
        creditCost: 1,
        unlimitedAtRequest: false,
        createdAt
      });
      requestId = inserted.insertedId;
      const result = await askBiwengerAi({
        userId: req.auth.user._id,
        question: input.question,
        preset: input.preset,
        context: input.context
      });
      await database.collection("ai_requests").updateOne({ _id: requestId }, { $set: {
        status: "completed",
        completedAt: new Date(),
        model: result.model,
        responseId: result.responseId,
        usage: result.usage
      } });
      res.json({
        answer: result.answer,
        model: result.model,
        usage: result.usage,
        credits
      });
    } catch (error) {
      if (creditReserved) {
        try { await refundAiCredit(req.auth.user._id); } catch (_refundError) { /* Se reintentará manualmente si Mongo falla. */ }
      }
      if (requestId) {
        try {
          const database = await db();
          await database.collection("ai_requests").updateOne({ _id: requestId }, { $set: {
            status: "failed", failedAt: new Date(), error: String(error.message || "Error").slice(0, 300)
          } });
        } catch (_logError) {
          // El error original es el relevante para el cliente.
        }
      }
      next(error);
    }
  });

  app.post("/api/v1/predictions/sync", requireAuth, datasetRateLimit, async (req, res, next) => {
    try {
      const result = await storePredictionDataset(req.auth.user._id, req.body || {});
      res.json({ ok: true, ...result });
    } catch (error) { next(error); }
  });

  app.post("/api/v1/diagnostics/sync", requireAuth, datasetRateLimit, async (req, res, next) => {
    try {
      const result = await storeDiagnosticDump(req.auth.user._id, req.body || {});
      res.json({ ok: true, ...result });
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
        version: 3,
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

  app.use((_req, res) => res.status(404).json({ error: "Ruta no encontrada" }));

  app.use((error, _req, res, _next) => {
    const status = Number(error.status) || 500;
    if (status >= 500) console.error(error);
    res.status(status).json({ error: status >= 500 && process.env.NODE_ENV === "production" ? "Error interno" : error.message });
  });

  return app;
}

async function requireAuth(req, res, next) {
  try {
    const token = bearerToken(req.get("authorization"));
    const auth = await authenticateToken(token);
    if (!auth) return res.status(401).json({ error: "Sesión caducada o no válida" });
    req.authToken = token;
    req.auth = auth;
    next();
  } catch (error) { next(error); }
}

function rateLimit({ limit, windowMs, key }) {
  const windows = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const id = key(req);
    let current = windows.get(id);
    if (!current || now - current.startedAt >= windowMs) {
      current = { startedAt: now, count: 0 };
      windows.set(id, current);
    }
    current.count += 1;
    if (current.count > limit) return next(clientError("Demasiadas peticiones; inténtalo más tarde", 429));
    if (windows.size > 5000) {
      for (const [entryKey, entry] of windows) if (now - entry.startedAt >= windowMs) windows.delete(entryKey);
    }
    next();
  };
}

export function startServer() {
  return createApp().listen(config.port, "0.0.0.0", () => {
    console.log(`Biwenger escuchando en 0.0.0.0:${config.port}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startServer();
