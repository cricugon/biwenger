import test from "node:test";
import assert from "node:assert/strict";
import { validateDatasetPayload } from "../src/dataset.js";

test("valida y limita un lote de predicciones", () => {
  const valid = validateDatasetPayload({
    leagueKey: "liga-local-123",
    snapshots: [{
      id: "snapshot-1",
      capturedAt: "2026-08-05T07:00:00Z",
      algorithmVersion: "0.9.0",
      roundTiming: { phase: "deadline", nextRound: "Jornada 1", nextStartAt: "2026-08-05T19:00:00Z", hoursToNext: 12, deadlinePressure: .8, openMarket: 0, roundsKnown: 4 },
      players: [{
        key: "jugador-1", position: "DF", price: 1000000, value: 900000,
        predictions: [{ managerKey: "manager-1", score: .7, probability: 55, estimatedBid: 1100000,
          maxBid: null, maxBidUnlimited: true, features: [1, .9, .8, .7, .6, .5, .4, .3, .2, .1, 0] }]
      }]
    }]
  });
  assert.equal(valid.snapshots[0].players[0].predictions[0].probability, 55);
  assert.equal(valid.snapshots[0].players[0].predictions[0].maxBidUnlimited, true);
  assert.equal(valid.snapshots[0].players[0].predictions[0].features.length, 10);
  assert.equal(valid.snapshots[0].roundTiming.nextRound, "Jornada 1");
});

test("rechaza lotes sin liga o predicciones", () => {
  assert.throws(() => validateDatasetPayload({ leagueKey: "", snapshots: [{}] }));
  assert.throws(() => validateDatasetPayload({ leagueKey: "liga", snapshots: [] }));
});
