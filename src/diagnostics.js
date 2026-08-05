import { createHash } from "node:crypto";
import { db } from "./db.js";

function text(value, max = 200) {
  return String(value || "").trim().slice(0, max);
}

function jsonSize(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function validateDiagnosticDump(input = {}) {
  const leagueKey = text(input.leagueKey, 2000);
  const payload = input.payload;
  if (leagueKey.length < 3) throw Object.assign(new Error("Liga no válida"), { status: 400 });
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw Object.assign(new Error("Falta el diagnóstico"), { status: 400 });
  }
  if (jsonSize(payload) > 6_500_000) throw Object.assign(new Error("El diagnóstico supera 6,5 MB"), { status: 413 });
  const market = Array.isArray(payload.market) ? payload.market.slice(0, 100) : [];
  const managers = Array.isArray(payload.managers) ? payload.managers.slice(0, 100) : [];
  return {
    leagueKey,
    payload: {
      ...payload,
      generatedAt: text(payload.generatedAt, 40),
      algorithmVersion: text(payload.algorithmVersion, 30),
      leagueName: text(payload.leagueName, 160),
      market,
      managers
    }
  };
}

export async function storeDiagnosticDump(userId, input) {
  const valid = validateDiagnosticDump(input);
  const database = await db();
  const now = new Date();
  const leagueHash = createHash("sha256").update(valid.leagueKey).digest("hex");
  const result = await database.collection("diagnostic_dumps").findOneAndUpdate(
    { uploaderUserId: userId, leagueHash },
    {
      $set: {
        payload: valid.payload,
        leagueName: valid.payload.leagueName,
        generatedAt: valid.payload.generatedAt,
        algorithmVersion: valid.payload.algorithmVersion,
        updatedAt: now
      },
      $setOnInsert: { createdAt: now }
    },
    { upsert: true, returnDocument: "after" }
  );
  return { id: String(result._id), updatedAt: now.toISOString() };
}
