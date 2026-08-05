import { ObjectId } from "mongodb";
import { db } from "./db.js";
import { earliestDate, median, normalizeName, playerMatchScore, safeValue } from "./utils.js";

export async function storeFantasyPlayers(snapshot) {
  const database = await db();
  const now = new Date();
  const ids = snapshot.players.map(player => String(player.id));
  const existing = ids.length ? await database.collection("players").find({
    "sourceIds.futbolFantasy": { $in: ids }
  }).toArray() : [];
  const existingBySourceId = new Map(existing.map(player => [String(player.sourceIds.futbolFantasy), player]));
  if (snapshot.players.length) {
    await database.collection("players").bulkWrite(snapshot.players.map(player => {
      const previous = existingBySourceId.get(String(player.id));
      const biwengerCanonical = Boolean(previous && (previous.canonicalSource === "biwenger" ||
        (Array.isArray(previous.sourceIds && previous.sourceIds.biwenger) && previous.sourceIds.biwenger.length)));
      const canonicalName = biwengerCanonical ? previous.name : player.name;
      const canonicalTeam = biwengerCanonical ? previous.team : (player.team || "");
      const canonicalPosition = biwengerCanonical ? previous.position : (player.position || "");
      return {
        updateOne: {
          filter: { "sourceIds.futbolFantasy": String(player.id) },
          update: {
            $set: {
              name: canonicalName,
              normalizedName: normalizeName(canonicalName),
              position: canonicalPosition,
              team: canonicalTeam,
              normalizedTeam: normalizeName(canonicalTeam),
              fantasyIdentity: { name: player.name, team: player.team || "", position: player.position || "" },
              "sourceIds.futbolFantasy": String(player.id),
              updatedAt: now
            },
            $addToSet: { aliases: player.name },
            $setOnInsert: { createdAt: now }
          },
          upsert: true
        }
      };
    }), { ordered: false });
  }
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
  const reconciliation = await reconcilePlayerCatalog(database);
  return { players: stored.length, values: operations.length, merged: reconciliation.merged };
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

function biwengerIds(player) {
  const value = player && player.sourceIds && player.sourceIds.biwenger;
  return (Array.isArray(value) ? value : (value ? [value] : [])).map(String);
}

function uniqueMatch(request, candidates, minimumScore = 1_200) {
  const ranked = candidates.map(player => ({ player, score: playerMatchScore(request, player) }))
    .filter(result => result.score >= minimumScore)
    .sort((left, right) => right.score - left.score);
  if (!ranked.length) return null;
  if (ranked.length > 1 && ranked[0].score - ranked[1].score < 35) return null;
  return ranked[0];
}

async function mergePlayerRecords(database, canonical, duplicate) {
  if (!canonical || !duplicate || String(canonical._id) === String(duplicate._id)) return canonical;
  const canonicalFantasyId = canonical.sourceIds && canonical.sourceIds.futbolFantasy;
  const duplicateFantasyId = duplicate.sourceIds && duplicate.sourceIds.futbolFantasy;
  if (canonicalFantasyId && duplicateFantasyId && String(canonicalFantasyId) !== String(duplicateFantasyId)) return canonical;

  const duplicateValues = await database.collection("market_values").find({ playerId: duplicate._id }).toArray();
  if (duplicateValues.length) {
    await database.collection("market_values").bulkWrite(duplicateValues.map(entry => valueOperation(
      canonical._id, entry.date, entry.source, entry.value, entry.observedAt || entry.updatedAt || new Date(),
      { ...(entry.samples ? { samples: entry.samples } : {}) }
    )), { ordered: false });
  }

  const duplicateObservations = await database.collection("biwenger_observations").find({ playerId: duplicate._id }).toArray();
  await database.collection("player_merge_audit").insertOne({
    canonicalPlayerId: canonical._id,
    duplicatePlayerId: duplicate._id,
    canonicalBefore: canonical,
    duplicateBefore: duplicate,
    duplicateValues,
    duplicateObservations,
    mergedAt: new Date(),
    reversible: true
  });
  if (duplicateObservations.length) {
    await database.collection("biwenger_observations").bulkWrite(duplicateObservations.map(entry => ({
      updateOne: {
        filter: { clientId: entry.clientId, playerId: canonical._id, date: entry.date },
        update: {
          $set: {
            value: entry.value,
            observedAt: entry.observedAt,
            receivedAt: entry.receivedAt || new Date()
          },
          $setOnInsert: { createdAt: entry.createdAt || new Date() }
        },
        upsert: true
      }
    })), { ordered: false });
  }

  await Promise.all([
    database.collection("market_values").deleteMany({ playerId: duplicate._id }),
    database.collection("biwenger_observations").deleteMany({ playerId: duplicate._id })
  ]);
  await database.collection("players").deleteOne({ _id: duplicate._id });

  const sourceIds = {
    ...(canonical.sourceIds || {}),
    futbolFantasy: canonicalFantasyId || duplicateFantasyId || undefined,
    biwenger: Array.from(new Set([...biwengerIds(canonical), ...biwengerIds(duplicate)]))
  };
  if (!sourceIds.futbolFantasy) delete sourceIds.futbolFantasy;
  const aliases = Array.from(new Set([
    canonical.name, duplicate.name,
    ...(Array.isArray(canonical.aliases) ? canonical.aliases : []),
    ...(Array.isArray(duplicate.aliases) ? duplicate.aliases : [])
  ].filter(Boolean)));
  const mergedFields = {
    sourceIds,
    aliases,
    imports: { ...(duplicate.imports || {}), ...(canonical.imports || {}) },
    updatedAt: new Date()
  };
  if (sourceIds.biwenger.length) mergedFields.canonicalSource = "biwenger";
  if (!canonical.fantasyIdentity && duplicate.fantasyIdentity) mergedFields.fantasyIdentity = duplicate.fantasyIdentity;
  await database.collection("players").updateOne({ _id: canonical._id }, { $set: mergedFields });
  return { ...canonical, ...mergedFields };
}

export async function reconcilePlayerCatalog(existingDatabase, options = {}) {
  const database = existingDatabase || await db();
  let players = await database.collection("players").find({}).toArray();
  const canonicals = players.filter(player => biwengerIds(player).length);
  const fantasyOnly = players.filter(player => player.sourceIds && player.sourceIds.futbolFantasy && !biwengerIds(player).length);
  let merged = 0;
  const details = [];
  for (const fantasy of fantasyOnly) {
    const match = uniqueMatch({
      name: fantasy.name,
      team: fantasy.team,
      position: fantasy.position
    }, canonicals.filter(canonical => !canonical.sourceIds?.futbolFantasy), 1_200);
    if (!match) continue;
    const canonical = match.player;
    details.push({ canonical: canonical.name, alias: fantasy.name, score: match.score });
    if (options.dryRun) continue;
    await mergePlayerRecords(database, canonical, fantasy);
    canonical.sourceIds = {
      ...(canonical.sourceIds || {}),
      futbolFantasy: fantasy.sourceIds.futbolFantasy,
      biwenger: biwengerIds(canonical)
    };
    canonical.fantasyIdentity = fantasy.fantasyIdentity || {
      name: fantasy.name, team: fantasy.team, position: fantasy.position
    };
    merged += 1;
  }
  return { merged, candidates: details.length, details };
}

async function resolveObservedPlayer(database, input) {
  const normalizedName = normalizeName(input.name);
  const normalizedTeam = normalizeName(input.team);
  const filters = [{ normalizedName }];
  if (normalizedTeam) filters.push({ normalizedTeam });
  if (input.id) filters.push({ "sourceIds.biwenger": String(input.id) });
  const candidates = await database.collection("players").find({ $or: filters }).limit(80).toArray();
  const requested = { name: input.name, team: input.team, position: input.position, positionCode: input.positionCode, id: input.id };
  const exactId = input.id ? candidates.find(item => biwengerIds(item).includes(String(input.id))) : null;
  const exactBiwengerName = candidates.find(item => item.normalizedName === normalizedName && biwengerIds(item).length &&
    (!normalizedTeam || !item.normalizedTeam || item.normalizedTeam === normalizedTeam));
  const best = uniqueMatch(requested, candidates);
  let player = exactId || exactBiwengerName || (best && best.player);
  if (player) {
    const previousName = player.name;
    const update = {
      name: String(input.name).trim(),
      normalizedName,
      team: String(input.team || player.team || "").trim(),
      normalizedTeam: normalizedTeam || player.normalizedTeam || "",
      position: String(input.position || input.positionCode || player.position || "").trim(),
      canonicalSource: "biwenger",
      updatedAt: new Date()
    };
    await database.collection("players").updateOne({ _id: player._id }, {
      $addToSet: {
        ...(input.id ? { "sourceIds.biwenger": String(input.id) } : {}),
        aliases: previousName
      },
      $set: update
    });
    player = { ...player, ...update, sourceIds: {
      ...(player.sourceIds || {}),
      biwenger: Array.from(new Set([...biwengerIds(player), ...(input.id ? [String(input.id)] : [])]))
    } };

    const mergeCandidates = candidates.filter(candidate => String(candidate._id) !== String(player._id) &&
      candidate.sourceIds && candidate.sourceIds.futbolFantasy);
    const duplicate = uniqueMatch(requested, mergeCandidates);
    if (duplicate && (!player.sourceIds.futbolFantasy ||
      String(player.sourceIds.futbolFantasy) === String(duplicate.player.sourceIds.futbolFantasy))) {
      player = await mergePlayerRecords(database, player, duplicate.player);
    }
    return player;
  }
  const document = {
    name: String(input.name).trim(), normalizedName,
    team: String(input.team || "").trim(), normalizedTeam,
    position: String(input.position || "").trim(),
    sourceIds: { biwenger: input.id ? [String(input.id)] : [] },
    aliases: [], canonicalSource: "biwenger",
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

  await reconcilePlayerCatalog(database);

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
