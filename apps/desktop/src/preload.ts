import { contextBridge, ipcRenderer } from "electron";
import { decodeEngineArg } from "./engineArg.js";
import { IPC_PICK_FOLDER, IPC_PICK_MEDIA, IPC_REVEAL } from "./ipc.js";

// Minimal API: where the engine is, its session token, and native dialogs.
contextBridge.exposeInMainWorld("veDesktop", {
  engine: decodeEngineArg(process.argv),
  pickFolder: (title: string): Promise<string | null> => ipcRenderer.invoke(IPC_PICK_FOLDER, title),
  pickMedia: (title: string): Promise<string[]> => ipcRenderer.invoke(IPC_PICK_MEDIA, title),
  revealInFolder: (file: string): Promise<void> => ipcRenderer.invoke(IPC_REVEAL, file),
});
