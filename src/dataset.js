import { createHmac } from "node:crypto";
import { config } from "./config.js";
import { db } from "./db.js";

function text(value, maximum = 160) {
  return String(value || "").trim().slice(0, maximum);
}

function number(value, minimum = 0, maximum = 1_000_000_000) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : 0;
}

function hash(value) {
  return createHmac("sha256", config.datasetHashSalt).update(String(value || "")).digest("hex");
}

export function validateDatasetPayload(input = {}) {
  const leagueKey = text(input.leagueKey, 2000);
  if (leagueKey.length < 3) throw Object.assign(new Error("Liga no válida"), { status: 400 });
  const snapshots = Array.isArray(input.snapshots) ? input.snapshots.slice(0, 20) : [];
  if (!snapshots.length) throw Object.assign(new Error("No hay predicciones para guardar"), { status: 400 });
  return {
    leagueKey,
    snapshots: snapshots.map(snapshot => {
      const id = text(snapshot && snapshot.id, 140);
      if (!id) throw Object.assign(new Error("Predicción sin identificador"), { status: 400 });
      return {
        id,
        capturedAt: text(snapshot.capturedAt, 40),
        algorithmVersion: text(snapshot.algorithmVersion, 30),
        players: (Array.isArray(snapshot.players) ? snapshot.players : []).slice(0, 80).map(player => ({
          key: text(player.key, 220),
          position: ["PT", "DF", "MC", "DL", "?"].includes(player.position) ? player.position : "?",
          price: number(player.price),
          value: number(player.value),
          listedPreviously: Boolean(player.listedPreviously),
          predictions: (Array.isArray(player.predictions) ? player.predictions : []).slice(0, 60).map(prediction => ({
            managerKey: text(prediction.managerKey, 220),
            score: number(prediction.score, 0, 1),
            probability: number(prediction.probability, 0, 100),
            estimatedBid: number(prediction.estimatedBid),
            maxBid: number(prediction.maxBid),
            maxBidUnlimited: Boolean(prediction.maxBidUnlimited),
            confidence: number(prediction.confidence, 0, 1),
            features: (Array.isArray(prediction.features) ? prediction.features : []).slice(0, 8)
              .map(value => number(value, 0, 1))
          })).filter(prediction => prediction.managerKey),
          outcome: player.outcome ? {
            buyerKey: text(player.outcome.buyerKey, 220),
            amount: number(player.outcome.amount),
            resolvedAt: text(player.outcome.resolvedAt, 40),
            bidsComplete: Boolean(player.outcome.bidsComplete),
            bids: (Array.isArray(player.outcome.bids) ? player.outcome.bids : []).slice(0, 60).map(bid => ({
              managerKey: text(bid.managerKey, 220),
              amount: number(bid.amount),
              rank: Math.round(number(bid.rank, 0, 100))
            })).filter(bid => bid.managerKey && bid.amount > 0)
          } : null
        })).filter(player => player.key && player.predictions.length)
      };
    })
  };
}

export async function storePredictionDataset(userId, input) {
  const valid = validateDatasetPayload(input);
  const database = await db();
  const leagueHash = hash(`league:${valid.leagueKey}`);
  const now = new Date();
  let accepted = 0;
  for (const snapshot of valid.snapshots) {
    const players = snapshot.players.map(player => ({
      playerHash: hash(`player:${leagueHash}:${player.key}`),
      position: player.position,
      price: player.price,
      value: player.value,
      listedPreviously: player.listedPreviously,
      predictions: player.predictions.map(prediction => ({
        managerHash: hash(`manager:${leagueHash}:${prediction.managerKey}`),
        score: prediction.score,
        probability: prediction.probability,
        estimatedBid: prediction.estimatedBid,
        maxBid: prediction.maxBid,
        maxBidUnlimited: prediction.maxBidUnlimited,
        confidence: prediction.confidence,
        features: prediction.features
      })),
      outcome: player.outcome ? {
        buyerHash: player.outcome.buyerKey ? hash(`manager:${leagueHash}:${player.outcome.buyerKey}`) : "",
        amount: player.outcome.amount,
        resolvedAt: player.outcome.resolvedAt,
        bidsComplete: player.outcome.bidsComplete,
        bids: player.outcome.bids.map(bid => ({
          managerHash: hash(`manager:${leagueHash}:${bid.managerKey}`),
          amount: bid.amount,
          rank: bid.rank
        }))
      } : null
    }));
    await database.collection("prediction_datasets").updateOne(
      { uploaderUserId: userId, leagueHash, snapshotId: snapshot.id },
      {
        $set: {
          capturedAt: snapshot.capturedAt,
          algorithmVersion: snapshot.algorithmVersion,
          players,
          updatedAt: now
        },
        $setOnInsert: { createdAt: now }
      },
      { upsert: true }
    );
    accepted += 1;
  }
  return { accepted };
}
