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

test("relaciona el nombre corto de Biwenger con FútbolFantasy por equipo y posición", () => {
  const score = playerMatchScore(
    { name: "Dituro", team: "Elche", position: "PT", id: "biwenger-dituro" },
    { name: "Matías Dituro", team: "Elche", position: "Portero", sourceIds: { futbolFantasy: "999" } }
  );
  assert.ok(score >= 1_500);
});

test("permite variantes parciales si equipo y posición eliminan la ambigüedad", () => {
  const score = playerMatchScore(
    { name: "Rafa Mir", team: "Elche", position: "Delantero" },
    { name: "Rafael Mir Vicente", team: "Elche", position: "DL", sourceIds: { futbolFantasy: "998" } }
  );
  assert.ok(score >= 1_200);
});

test("rechaza equipos distintos y apellidos ambiguos", () => {
  assert.equal(playerMatchScore(
    { name: "Diego Llorente", team: "Betis" },
    { name: "Diego Javier Llorente", team: "Otro", sourceIds: { futbolFantasy: "707" } }
  ), -1);
  assert.equal(playerMatchScore(
    { name: "Dituro", team: "Elche", position: "Portero" },
    { name: "Matías Dituro", team: "Elche", position: "Defensa", sourceIds: { futbolFantasy: "999" } }
  ), -1);
  assert.equal(playerMatchScore(
    { name: "Javier Rueda", team: "Celta", position: "Defensa" },
    { name: "Javi Rodríguez", team: "Celta", position: "DF", sourceIds: { futbolFantasy: "997" } }
  ), -1);
  assert.equal(playerMatchScore(
    { name: "Llorente" },
    { name: "Diego Javier Llorente", team: "Betis", sourceIds: { futbolFantasy: "707" } }
  ), -1);
});
