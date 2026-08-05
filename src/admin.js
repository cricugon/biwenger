import { createHmac, timingSafeEqual } from "node:crypto";
import { ObjectId } from "mongodb";
import { config } from "./config.js";
import { clientError, normalizeEmail, publicUser } from "./auth.js";
import { db } from "./db.js";

const COOKIE_NAME = "biwenia_admin";

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

function signature(value) {
  return createHmac("sha256", config.adminSessionSecret).update(value).digest("base64url");
}

function cookieValue(req, name) {
  const cookies = String(req.get("cookie") || "").split(";");
  for (const cookie of cookies) {
    const index = cookie.indexOf("=");
    if (index > 0 && cookie.slice(0, index).trim() === name) return decodeURIComponent(cookie.slice(index + 1));
  }
  return "";
}

function issueAdminToken() {
  const payload = Buffer.from(JSON.stringify({
    user: config.adminUsername,
    expiresAt: Date.now() + config.adminSessionHours * 3600000
  })).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

function validAdminToken(token) {
  const [payload, supplied] = String(token || "").split(".");
  if (!payload || !supplied || !safeEqual(signature(payload), supplied)) return false;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return session.user === config.adminUsername && Number(session.expiresAt) > Date.now();
  } catch (_error) {
    return false;
  }
}

export function adminConfigured() {
  return adminConfigurationProblems().length === 0;
}

export function adminConfigurationProblems() {
  const problems = [];
  if (config.adminUsername.length < 1) problems.push("ADMIN_USERNAME");
  if (config.adminPassword.length < 12) problems.push("ADMIN_PASSWORD (mínimo 12 caracteres)");
  if (config.adminSessionSecret.length < 24) problems.push("ADMIN_SESSION_SECRET (mínimo 24 caracteres)");
  return problems;
}

export function adminLogin(req, res) {
  const configurationProblems = adminConfigurationProblems();
  if (configurationProblems.length) {
    throw clientError("El panel no está configurado: revisa " + configurationProblems.join(", "), 503);
  }
  const username = String(req.body && req.body.username || "").trim();
  const password = String(req.body && req.body.password || "");
  if (!safeEqual(username, config.adminUsername) || !safeEqual(password, config.adminPassword)) {
    throw clientError("Credenciales incorrectas", 401);
  }
  const secure = req.secure || String(req.get("x-forwarded-proto") || "").includes("https");
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(issueAdminToken())}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${config.adminSessionHours * 3600}${secure ? "; Secure" : ""}`);
  return { ok: true, username: config.adminUsername };
}

export function adminLogout(_req, res) {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0`);
  return { ok: true };
}

export function requireAdmin(req, res, next) {
  if (!validAdminToken(cookieValue(req, COOKIE_NAME))) return res.status(401).json({ error: "Acceso administrativo requerido" });
  if (req.method !== "GET" && req.get("x-admin-request") !== "1") {
    return res.status(403).json({ error: "Petición administrativa no válida" });
  }
  res.setHeader("Cache-Control", "no-store");
  next();
}

export async function adminSummary() {
  const database = await db();
  const [users, players, values, diagnostics, ai] = await Promise.all([
    database.collection("users").countDocuments(),
    database.collection("players").countDocuments(),
    database.collection("market_values").countDocuments(),
    database.collection("diagnostic_dumps").countDocuments(),
    database.collection("ai_requests").countDocuments({ status: "completed" })
  ]);
  return { users, players, values, diagnostics, ai };
}

export async function adminUsers(query = {}) {
  const database = await db();
  const search = String(query.search || "").trim();
  const filter = search ? { $or: [
    { email: { $regex: escapeRegex(search), $options: "i" } },
    { displayName: { $regex: escapeRegex(search), $options: "i" } }
  ] } : {};
  const users = await database.collection("users").find(filter).sort({ createdAt: -1 }).limit(500).toArray();
  const userIds = users.map(user => user._id);
  const usage = userIds.length ? await database.collection("ai_requests").aggregate([
    { $match: { userId: { $in: userIds }, status: "completed" } },
    { $group: { _id: "$userId", requests: { $sum: 1 }, tokens: { $sum: "$usage.totalTokens" } } }
  ]).toArray() : [];
  const usageMap = new Map(usage.map(item => [String(item._id), item]));
  return users.map(user => ({
    ...publicUser(user),
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    aiRequests: Number(usageMap.get(String(user._id))?.requests) || 0,
    totalTokens: Number(usageMap.get(String(user._id))?.tokens) || 0
  }));
}

export async function updateUserCredits(id, input = {}) {
  if (!ObjectId.isValid(id)) throw clientError("Usuario no válido");
  const balance = Math.min(1_000_000, Math.max(0, Math.floor(Number(input.balance) || 0)));
  const database = await db();
  const user = await database.collection("users").findOneAndUpdate(
    { _id: new ObjectId(id) },
    { $set: { credits: { unlimited: false, balance }, updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  if (!user) throw clientError("Usuario no encontrado", 404);
  return { user: publicUser(user) };
}

export async function deleteUser(id) {
  if (!ObjectId.isValid(id)) throw clientError("Usuario no válido");
  const database = await db();
  const userId = new ObjectId(id);
  const result = await database.collection("users").deleteOne({ _id: userId });
  if (!result.deletedCount) throw clientError("Usuario no encontrado", 404);
  await Promise.all([
    database.collection("sessions").deleteMany({ userId }),
    database.collection("ai_requests").deleteMany({ userId }),
    database.collection("prediction_datasets").deleteMany({ uploaderUserId: userId }),
    database.collection("diagnostic_dumps").deleteMany({ uploaderUserId: userId })
  ]);
  return { ok: true };
}

export async function adminMarketValues(query = {}) {
  const database = await db();
  const page = Math.max(1, Number.parseInt(query.page || "1", 10));
  const limit = Math.min(100, Math.max(10, Number.parseInt(query.limit || "50", 10)));
  const valueMatch = {};
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(query.from || ""))) valueMatch.date = { $gte: String(query.from) };
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(query.to || ""))) valueMatch.date = { ...(valueMatch.date || {}), $lte: String(query.to) };
  if (query.source) valueMatch.source = String(query.source).slice(0, 30);
  if (query.playerId && ObjectId.isValid(query.playerId)) valueMatch.playerId = new ObjectId(query.playerId);
  const playerMatch = {};
  const search = String(query.search || "").trim();
  if (search) playerMatch["player.name"] = { $regex: escapeRegex(search), $options: "i" };
  const pipeline = [
    { $match: valueMatch },
    { $lookup: { from: "players", localField: "playerId", foreignField: "_id", as: "player" } },
    { $unwind: "$player" },
    ...(Object.keys(playerMatch).length ? [{ $match: playerMatch }] : []),
    { $sort: { date: -1, "player.name": 1 } },
    { $facet: {
      items: [
        { $skip: (page - 1) * limit }, { $limit: limit },
        { $project: { _id: 0, id: { $toString: "$_id" }, date: 1, value: 1, source: 1, samples: 1,
          playerId: { $toString: "$player._id" }, name: "$player.name", team: "$player.team", position: "$player.position" } }
      ],
      count: [{ $count: "total" }]
    } }
  ];
  const [result = { items: [], count: [] }] = await database.collection("market_values").aggregate(pipeline).toArray();
  return { items: result.items, total: Number(result.count[0]?.total) || 0, page, limit };
}

export async function adminDiagnostics(query = {}) {
  const database = await db();
  const search = String(query.search || "").trim();
  const pipeline = [
    { $lookup: { from: "users", localField: "uploaderUserId", foreignField: "_id", as: "user" } },
    { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
    ...(search ? [{ $match: { $or: [
      { "user.email": { $regex: escapeRegex(search), $options: "i" } },
      { "user.displayName": { $regex: escapeRegex(search), $options: "i" } },
      { leagueName: { $regex: escapeRegex(search), $options: "i" } }
    ] } }] : []),
    { $sort: { updatedAt: -1 } }, { $limit: 200 },
    { $project: { _id: 0, id: { $toString: "$_id" }, leagueName: 1, generatedAt: 1, updatedAt: 1,
      algorithmVersion: 1, marketCount: { $size: { $ifNull: ["$payload.market", []] } },
      managerCount: { $size: { $ifNull: ["$payload.managers", []] } },
      user: { email: "$user.email", displayName: "$user.displayName" } } }
  ];
  return database.collection("diagnostic_dumps").aggregate(pipeline).toArray();
}

export async function adminDiagnostic(id) {
  if (!ObjectId.isValid(id)) throw clientError("Diagnóstico no válido");
  const database = await db();
  const item = await database.collection("diagnostic_dumps").findOne({ _id: new ObjectId(id) });
  if (!item) throw clientError("Diagnóstico no encontrado", 404);
  const user = await database.collection("users").findOne({ _id: item.uploaderUserId }, { projection: { email: 1, displayName: 1 } });
  return { id: String(item._id), user, updatedAt: item.updatedAt, ...item.payload };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
