import test from "node:test";
import assert from "node:assert/strict";
import { playerMatchScore } from "../src/utils.js";

test("relaciona un nombre abreviado con el nombre completo", () => {
  const score = playerMatchScore(
    { name: "Diego Llorente", team: "Betis" },
    { name: "Diego Javier Llorente", team: "Betis", sourceIds: { futbolFantasy: "707" } }
  );
  assert.ok(score > 0);
});

test("rechaza equipos distintos y apellidos ambiguos", () => {
  assert.equal(playerMatchScore(
    { name: "Diego Llorente", team: "Betis" },
    { name: "Diego Javier Llorente", team: "Otro", sourceIds: { futbolFantasy: "707" } }
  ), -1);
  assert.equal(playerMatchScore(
    { name: "Llorente" },
    { name: "Diego Javier Llorente", team: "Betis", sourceIds: { futbolFantasy: "707" } }
  ), -1);
});
