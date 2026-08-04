import "dotenv/config";
import { closeDb } from "../db.js";
import { importFantasyDaily } from "../importer.js";

try {
  const result = await importFantasyDaily({ enforceMadridTime: true });
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
