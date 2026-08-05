import { MongoClient } from "mongodb";
import { config, requireMongoUri } from "./config.js";

let client;
let database;

export async function db() {
  if (database) return database;
  client = new MongoClient(requireMongoUri(), { appName: "biwenger-market-values" });
  await client.connect();
  database = client.db(config.mongoDb);
  await ensureIndexes(database);
  return database;
}

async function ensureIndexes(database) {
  await Promise.all([
    database.collection("players").createIndex({ "sourceIds.futbolFantasy": 1 }, { unique: true, sparse: true }),
    database.collection("players").createIndex({ normalizedName: 1, normalizedTeam: 1 }),
    database.collection("market_values").createIndex({ playerId: 1, date: 1, source: 1 }, { unique: true }),
    database.collection("market_values").createIndex({ playerId: 1, date: -1 }),
    database.collection("biwenger_observations").createIndex({ clientId: 1, playerId: 1, date: 1 }, { unique: true }),
    database.collection("biwenger_observations").createIndex({ playerId: 1, date: 1 }),
    database.collection("job_runs").createIndex({ key: 1 }, { unique: true }),
    database.collection("users").createIndex({ email: 1 }, { unique: true }),
    database.collection("sessions").createIndex({ tokenHash: 1 }, { unique: true }),
    database.collection("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    database.collection("sessions").createIndex({ userId: 1, createdAt: -1 }),
    database.collection("ai_requests").createIndex({ userId: 1, createdAt: -1 }),
    database.collection("prediction_datasets").createIndex(
      { uploaderUserId: 1, leagueHash: 1, snapshotId: 1 }, { unique: true }
    ),
    database.collection("prediction_datasets").createIndex({ leagueHash: 1, capturedAt: -1 }),
    database.collection("prediction_datasets").createIndex({ "players.outcome.resolvedAt": -1 }),
    database.collection("diagnostic_dumps").createIndex(
      { uploaderUserId: 1, leagueHash: 1 }, { unique: true }
    ),
    database.collection("diagnostic_dumps").createIndex({ updatedAt: -1 })
  ]);
}

export async function closeDb() {
  if (client) await client.close();
  client = undefined;
  database = undefined;
}
