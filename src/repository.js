import { ObjectId } from "mongodb";
import { db } from "./db.js";
import { earliestDate, median, normalizeName, playerMatchScore, safeValue } from "./utils.js";

export async function storeFantasyPlayers(snapshot) {
  const database = await db();
  const now = new Date();
  if (snapshot.players.length) {
    await database.collection("players").bulkWrite(snapshot.players.map(player => ({
      updateOne: {
        filter: { "sourceIds.futbolFantasy": String(player.id) },
        update: {
          $set: {
            name: player.name,
            normalizedName: normalizeName(player.name),
            position: player.position || "",
            team: player.team || "",
            normalizedTeam: normalizeName(player.team),
            "sourceIds.futbolFantasy": String(player.id),
            updatedAt: now
          },
          $setOnInsert: { createdAt: now }
        },
        upsert: true
      }
    })), { ordered: false });
  }
  const ids = snapshot.players.map(player => String(player.id));
  const stored = await database.collection("players").find({ "sourceIds.futbolFantasy": { $in: ids } }).toArray();
  const bySourceId = new Map(stored.map(player => [player.sourceIds.futbolFantasy, player]));
  const operations = [];
  for (const player of snapshot.players) {
    const storedPlayer = bySourceId.get(String(player.id));
    if (!storedPlayer) continue;
    for (const [date, value] of Object.entries(player.values || {})) {
      operations.push(valueOperation(storedPlayer._id, date, "futbolfantasy", value, now));
    }
  }
  if (operations.length) await database.collection("market_values").bulkWrite(operations, { ordered: false });
  return { players: stored.length, values: operations.length };
}

function valueOperation(playerId, date, source, value, observedAt = new Date(), extra = {}) {
  return {
    updateOne: {
      filter: { playerId, date, source },
      update: {
        $set: { value: safeValue(value), observedAt, updatedAt: new Date(), ...extra },
        $setOnInsert: { createdAt: new Date() }
      },
      upsert: true
    }
  };
}

export async function storeFantasyDetail(sourceId, values) {
  const database = await db();
  const player = await database.collection("players").findOne({ "sourceIds.futbolFantasy": String(sourceId) });
  if (!player) return 0;
  const operations = Object.entries(values).map(([date, value]) => valueOperation(player._id, date, "futbolfantasy", value));
  if (operations.length) await database.collection("market_values").bulkWrite(operations, { ordered: false });
  await database.collection("players").updateOne({ _id: player._id }, { $set: { "imports.fantasyDetailAt": new Date() } });
  return operations.length;
}

export async function fantasyPlayersPendingDetail(force = false) {
  const database = await db();
  const filter = { "sourceIds.futbolFantasy": { $exists: true } };
  if (!force) filter["imports.fantasyDetailAt"] = { $exists: false };
  return database.collection("players").find(filter).sort({ normalizedName: 1 }).toArray();
}

async function resolveObservedPlayer(database, input) {
  const normalizedName = normalizeName(input.name);
  const normalizedTeam = normalizeName(input.team);
  const candidates = await database.collection("players").find({ normalizedName }).limit(5).toArray();
  let player = candidates.find(item => normalizedTeam && item.normalizedTeam === normalizedTeam) || candidates[0];
  if (player) {
    if (input.id) await database.collection("players").updateOne({ _id: player._id }, {
      $addToSet: { "sourceIds.biwenger": String(input.id) }, $set: { updatedAt: new Date() }
    });
    return player;
  }
  const document = {
    name: String(input.name).trim(), normalizedName,
    team: String(input.team || "").trim(), normalizedTeam,
    position: String(input.position || "").trim(),
    sourceIds: { biwenger: input.id ? [String(input.id)] : [] },
    createdAt: new Date(), updatedAt: new Date()
  };
  const inserted = await database.collection("players").insertOne(document);
  return { ...document, _id: inserted.insertedId };
}

export async function storeBiwengerObservations(payload) {
  const database = await db();
  const now = new Date();
  const affected = new Map();
  const operations = [];
  for (const input of payload.players) {
    const value = safeValue(input.value);
    if (!value || !normalizeName(input.name)) continue;
    const player = await resolveObservedPlayer(database, input);
    affected.set(String(player._id), player._id);
    operations.push({
      updateOne: {
        filter: { clientId: payload.clientId, playerId: player._id, date: payload.observedDate },
        update: {
          $set: { value, observedAt: new Date(payload.observedAt || now), receivedAt: now },
          $setOnInsert: { createdAt: now }
        },
        upsert: true
      }
    });
  }
  if (operations.length) await database.collection("biwenger_observations").bulkWrite(operations, { ordered: false });
  let corrected = 0;
  for (const playerId of affected.values()) {
    const observations = await database.collection("biwenger_observations")
      .find({ playerId, date: payload.observedDate }).project({ value: 1 }).toArray();
    const consensus = median(observations.map(item => item.value));
    if (!consensus) continue;
    await database.collection("market_values").bulkWrite([
      valueOperation(playerId, payload.observedDate, "biwenger", consensus, now, { samples: observations.length })
    ]);
    corrected += 1;
  }
  return { accepted: operations.length, corrected, players: affected.size };
}

export async function queryValues(requestedPlayers, days) {
  const database = await db();
  const requests = [];
  const seen = new Set();
  for (const raw of requestedPlayers.slice(0, 500)) {
    const input = typeof raw === "string" ? { name: raw } : (raw || {});
    const key = [normalizeName(input.name), normalizeName(input.team), String(input.id || "")].join("|");
    if (!normalizeName(input.name) || seen.has(key)) continue;
    seen.add(key);
    requests.push(input);
  }
  if (!requests.length) return [];

  const catalog = await database.collection("players").find({}).project({
    name: 1, normalizedName: 1, team: 1, normalizedTeam: 1, position: 1, sourceIds: 1
  }).toArray();
  const selected = new Map();
  for (const request of requests) {
    const ranked = catalog.map(player => ({ player, score: playerMatchScore(request, player) }))
      .filter(result => result.score >= 0)
      .sort((left, right) => right.score - left.score);
    if (!ranked.length) continue;
    if (ranked.length > 1 && ranked[0].score === ranked[1].score) continue;
    selected.set(String(ranked[0].player._id), ranked[0].player);
  }
  const players = [...selected.values()];
  const playerIds = players.map(player => player._id);
  const values = await database.collection("market_values").find({
    playerId: { $in: playerIds }, date: { $gte: earliestDate(days) }
  }).sort({ date: 1 }).toArray();
  const valuesByPlayer = new Map();
  for (const entry of values) {
    const key = String(entry.playerId);
    if (!valuesByPlayer.has(key)) valuesByPlayer.set(key, new Map());
    const dates = valuesByPlayer.get(key);
    const previous = dates.get(entry.date);
    if (!previous || entry.source === "biwenger") dates.set(entry.date, entry);
  }
  return players.map(player => {
    const dates = valuesByPlayer.get(String(player._id)) || new Map();
    return {
      id: player.sourceIds && player.sourceIds.futbolFantasy ? player.sourceIds.futbolFantasy : String(player._id),
      name: player.name,
      position: player.position || "",
      team: player.team || "",
      values: Object.fromEntries([...dates.entries()].map(([date, entry]) => [date, entry.value])),
      valueSources: Object.fromEntries([...dates.entries()].map(([date, entry]) => [date, entry.source]))
    };
  });
}

export function objectId(value) {
  return ObjectId.isValid(value) ? new ObjectId(value) : null;
}
