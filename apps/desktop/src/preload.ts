import { contextBridge } from "electron";
import { decodeEngineArg } from "./engineArg.js";

// Minimal API: the client only learns where the engine is and its session token.
contextBridge.exposeInMainWorld("veDesktop", { engine: decodeEngineArg(process.argv) });
