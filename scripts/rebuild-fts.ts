import { loadConfig } from "../apps/api/src/config.js";
import { openDatabase, rebuildFts } from "../apps/api/src/db/index.js";

const config = loadConfig();
const handle = openDatabase(config.databasePath);
try {
	rebuildFts(handle.sqlite);
	console.log("FTS index rebuilt");
} finally {
	handle.close();
}
