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
      players: [{
        key: "jugador-1", position: "DF", price: 1000000, value: 900000,
        predictions: [{ managerKey: "manager-1", score: .7, probability: 55, estimatedBid: 1100000 }]
      }]
    }]
  });
  assert.equal(valid.snapshots[0].players[0].predictions[0].probability, 55);
});

test("rechaza lotes sin liga o predicciones", () => {
  assert.throws(() => validateDatasetPayload({ leagueKey: "", snapshots: [{}] }));
  assert.throws(() => validateDatasetPayload({ leagueKey: "liga", snapshots: [] }));
});
