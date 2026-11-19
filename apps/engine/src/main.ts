import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { exitWhenParentGone } from "./parentWatch.js";
import { closeDiagnosticSink, configureDiagnosticSink } from "./diagnostics.js";

const config = loadConfig();
configureDiagnosticSink(config.dataDir);
const app = await buildApp(config);

const shutdown = async () => {
  try {
    await app.close();
  } finally {
    closeDiagnosticSink();
  }
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
if (config.exitWhenParentGone) exitWhenParentGone(process.stdin, () => void shutdown());

await app.listen({ host: config.host, port: config.port });
console.log(`engine listening on http://${config.host}:${config.port}`);
