import test from "node:test";
import assert from "node:assert/strict";
import { parseFantasyDetail, parseFantasyMarket } from "../src/futbol-fantasy.js";

test("parsea tabla y fechas de FútbolFantasy", () => {
  const rows = Array.from({ length: 100 }, (_, index) =>
    `<tr class="elemento_jugador" data-id="${index}" data-nombre="Jugador ${index}" data-posicion="2" data-equipo="1" data-valor="1234567" data-valor1="1200000"><td><a class="player-name"><span>Jugador ${index}</span></a><div class="player-equipo"><span>Equipo</span></div></td></tr>`
  ).join("");
  const parsed = parseFantasyMarket(`Última actualización: 05/08/2026 07:10<table>${rows}</table>`);
  assert.equal(parsed.players.length, 100);
  assert.equal(parsed.players[0].values["2026-08-05"], 1234567);
  assert.equal(parsed.players[0].values["2026-08-04"], 1200000);
  assert.equal(parsed.players[0].team, "Equipo");
});

test("parsea todos los puntos disponibles de una ficha", () => {
  const values = parseFantasyDetail(
    'player_chartjs.push({date:"04/08",value:1000000});player_chartjs.push({date:"05/08",value:1100000});',
    "2026-08-05"
  );
  assert.deepEqual(values, { "2026-08-04": 1000000, "2026-08-05": 1100000 });
});
