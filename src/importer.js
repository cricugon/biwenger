import { db } from "./db.js";
import { downloadFantasyMarket } from "./futbol-fantasy.js";
import { storeFantasyPlayers } from "./repository.js";

export async function importFantasyDaily({ enforceMadridTime = true } = {}) {
  const madrid = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date()).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  const date = `${madrid.year}-${madrid.month}-${madrid.day}`;
  if (enforceMadridTime && Number(madrid.hour) < 7) return { skipped: true, reason: "before-07:00-Europe/Madrid", date };
  const database = await db();
  const key = `futbolfantasy:${date}`;
  try {
    await database.collection("job_runs").insertOne({ key, status: "running", startedAt: new Date() });
  } catch (error) {
    if (error && error.code === 11000) return { skipped: true, reason: "already-imported", date };
    throw error;
  }
  try {
    const snapshot = await downloadFantasyMarket();
    if (snapshot.sourceDate !== date) {
      throw new Error(`FútbolFantasy todavía publica ${snapshot.sourceDate}; se reintentará para ${date}`);
    }
    const stored = await storeFantasyPlayers(snapshot);
    const result = { skipped: false, date, sourceUpdatedAt: snapshot.sourceUpdatedAt, ...stored };
    await database.collection("job_runs").updateOne({ key }, { $set: { status: "complete", completedAt: new Date(), result } });
    return result;
  } catch (error) {
    await database.collection("job_runs").deleteOne({ key });
    throw error;
  }
}
