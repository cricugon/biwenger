import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { ObjectId } from "mongodb";
import { config } from "./config.js";
import { db } from "./db.js";

const scrypt = promisify(scryptCallback);
const PASSWORD_KEY_LENGTH = 64;

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function validateRegistration(input = {}) {
  const email = normalizeEmail(input.email);
  const displayName = String(input.displayName || "").trim().replace(/\s+/g, " ");
  const password = String(input.password || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw clientError("Introduce un correo electrónico válido");
  }
  if (displayName.length < 2 || displayName.length > 50) {
    throw clientError("El nombre debe tener entre 2 y 50 caracteres");
  }
  if (password.length < 8 || password.length > 128) {
    throw clientError("La contraseña debe tener entre 8 y 128 caracteres");
  }
  return { email, displayName, password };
}

export function validateLogin(input = {}) {
  const email = normalizeEmail(input.email);
  const password = String(input.password || "");
  if (!email || !password) throw clientError("Correo y contraseña son obligatorios");
  return { email, password };
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, PASSWORD_KEY_LENGTH);
  return `scrypt$${salt.toString("base64url")}$${Buffer.from(derived).toString("base64url")}`;
}

export async function verifyPassword(password, encoded) {
  const [algorithm, saltText, hashText] = String(encoded || "").split("$");
  if (algorithm !== "scrypt" || !saltText || !hashText) return false;
  try {
    const expected = Buffer.from(hashText, "base64url");
    const actual = Buffer.from(await scrypt(password, Buffer.from(saltText, "base64url"), expected.length));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch (_error) {
    return false;
  }
}

export async function registerUser(input) {
  const valid = validateRegistration(input);
  const database = await db();
  const now = new Date();
  const document = {
    email: valid.email,
    displayName: valid.displayName,
    passwordHash: await hashPassword(valid.password),
    credits: { unlimited: true, balance: 0 },
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now
  };
  try {
    const result = await database.collection("users").insertOne(document);
    document._id = result.insertedId;
  } catch (error) {
    if (error && error.code === 11000) throw clientError("Ya existe una cuenta con ese correo", 409);
    throw error;
  }
  return issueSession(document, input.deviceName);
}

export async function loginUser(input) {
  const valid = validateLogin(input);
  const database = await db();
  const user = await database.collection("users").findOne({ email: valid.email });
  if (!user || !(await verifyPassword(valid.password, user.passwordHash))) {
    throw clientError("Correo o contraseña incorrectos", 401);
  }
  await database.collection("users").updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date(), updatedAt: new Date() } });
  return issueSession(user, input.deviceName);
}

async function issueSession(user, deviceName) {
  const database = await db();
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.sessionDays * 86400000);
  await database.collection("sessions").insertOne({
    tokenHash: tokenHash(token),
    userId: user._id,
    deviceName: String(deviceName || "Android").slice(0, 80),
    createdAt: now,
    lastUsedAt: now,
    expiresAt
  });
  return { token, expiresAt: expiresAt.toISOString(), user: publicUser(user) };
}

export async function authenticateToken(token) {
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(String(token || ""))) return null;
  const database = await db();
  const now = new Date();
  const session = await database.collection("sessions").findOne({ tokenHash: tokenHash(token), expiresAt: { $gt: now } });
  if (!session || !ObjectId.isValid(session.userId)) return null;
  const user = await database.collection("users").findOne({ _id: session.userId });
  if (!user) return null;
  database.collection("sessions").updateOne({ _id: session._id }, { $set: { lastUsedAt: now } }).catch(() => {});
  return { session, user, publicUser: publicUser(user) };
}

export async function revokeToken(token) {
  if (!token) return;
  const database = await db();
  await database.collection("sessions").deleteOne({ tokenHash: tokenHash(token) });
}

export function bearerToken(header) {
  const match = String(header || "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

export function publicUser(user) {
  return {
    id: String(user._id),
    email: user.email,
    displayName: user.displayName,
    credits: {
      unlimited: user.credits ? user.credits.unlimited !== false : true,
      balance: Number(user.credits && user.credits.balance) || 0
    }
  };
}

export function tokenHash(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

export function clientError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}
