import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { exitWhenParentGone } from "./parentWatch.js";

const config = loadConfig();
const app = await buildApp(config);

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
if (config.exitWhenParentGone) exitWhenParentGone(process.stdin, () => void shutdown());

await app.listen({ host: config.host, port: config.port });
console.log(`engine listening on http://${config.host}:${config.port}`);
