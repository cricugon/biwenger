import { config } from "../config.js";
import { closeDb } from "../db.js";
import { downloadFantasyDetail, downloadFantasyMarket } from "../futbol-fantasy.js";
import { fantasyPlayersPendingDetail, storeFantasyDetail, storeFantasyPlayers } from "../repository.js";
import { sleep } from "../utils.js";

const force = process.argv.includes("--force");
try {
  const snapshot = await downloadFantasyMarket();
  const stored = await storeFantasyPlayers(snapshot);
  console.log(`Tabla principal: ${stored.players} jugadores y ${stored.values} valores.`);
  const players = await fantasyPlayersPendingDetail(force);
  let completed = 0;
  let values = 0;
  for (const player of players) {
    const sourceId = player.sourceIds.futbolFantasy;
    try {
      const history = await downloadFantasyDetail(sourceId, snapshot.sourceDate);
      values += await storeFantasyDetail(sourceId, history);
      completed += 1;
      console.log(`[${completed}/${players.length}] ${player.name}: ${Object.keys(history).length} fechas`);
    } catch (error) {
      console.error(`[${completed + 1}/${players.length}] ${player.name}: ${error.message}`);
    }
    await sleep(config.detailDelayMs);
  }
  console.log(`Importación histórica terminada: ${completed} fichas y ${values} valores.`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
