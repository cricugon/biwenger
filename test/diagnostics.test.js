import test from "node:test";
import assert from "node:assert/strict";
import { validateDiagnosticDump } from "../src/diagnostics.js";

test("acepta y limita un volcado de diagnóstico", () => {
  const value = validateDiagnosticDump({
    leagueKey: "liga:123",
    payload: {
      generatedAt: "2026-08-05T12:00:00Z",
      algorithmVersion: "0.10.0",
      leagueName: "Liga de prueba",
      managers: [{ name: "Ana" }],
      market: [{ name: "Jugador", predictions: [] }]
    }
  });
  assert.equal(value.payload.leagueName, "Liga de prueba");
  assert.equal(value.payload.market.length, 1);
});

test("rechaza un diagnóstico vacío", () => {
  assert.throws(() => validateDiagnosticDump({ leagueKey: "liga", payload: null }));
});
