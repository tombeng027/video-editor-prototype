import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { encodeEngineArg } from "./engineArg.js";
import {
  buildEngineLaunch,
  clientOrigin,
  generateToken,
  getFreePort,
  waitForEngine,
} from "./engineLaunch.js";
import { IPC_PICK_FOLDER, IPC_PICK_MEDIA, IPC_REVEAL, MEDIA_EXTENSIONS, isRevealablePath, isTrustedSender, sanitizeTitle } from "./ipc.js";

const CLIENT_URL = process.env.VE_CLIENT_URL ?? "http://127.0.0.1:5173";
let engine: ChildProcess | undefined;

function stopEngine() {
  if (engine && !engine.killed) engine.kill();
  engine = undefined;
}

async function startEngine() {
  const port = await getFreePort();
  const token = generateToken();
  const launch = buildEngineLaunch({
    engineDir: path.resolve(__dirname, "..", "..", "engine"),
    execPath: process.execPath,
    port,
    token,
    clientUrl: CLIENT_URL,
    baseEnv: process.env,
  });
  engine = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env: launch.env,
    // stdin stays open so the engine can detect this process dying (see engine parentWatch).
    stdio: ["pipe", "inherit", "inherit"],
    windowsHide: true,
  });
  engine.once("exit", (code) => {
    if (!app.isReady() || BrowserWindow.getAllWindows().length === 0) return;
    if (code !== 0 && code !== null) dialog.showErrorBox("Engine stopped", `The engine exited with code ${code}.`);
  });
  const info = { url: `http://127.0.0.1:${port}`, token };
  await waitForEngine(info);
  return info;
}

ipcMain.handle(IPC_PICK_FOLDER, async (event, title: unknown) => {
  if (!isTrustedSender(event.senderFrame?.url, CLIENT_URL)) return null;
  const win = BrowserWindow.fromWebContents(event.sender);
  const options = {
    title: sanitizeTitle(title, "Choose a folder"),
    properties: ["openDirectory", "createDirectory"] as ("openDirectory" | "createDirectory")[],
  };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

ipcMain.handle(IPC_PICK_MEDIA, async (event, title: unknown) => {
  if (!isTrustedSender(event.senderFrame?.url, CLIENT_URL)) return [];
  const win = BrowserWindow.fromWebContents(event.sender);
  const options = {
    title: sanitizeTitle(title, "Import media"),
    properties: ["openFile", "multiSelections"] as ("openFile" | "multiSelections")[],
    filters: [{ name: "Video and audio", extensions: MEDIA_EXTENSIONS }, { name: "All files", extensions: ["*"] }],
  };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle(IPC_REVEAL, (event, file: unknown) => {
  if (!isTrustedSender(event.senderFrame?.url, CLIENT_URL) || !isRevealablePath(file)) return;
  shell.showItemInFolder(file);
});

async function createWindow() {
  const info = await startEngine();
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: "#14161a",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [encodeEngineArg(info)],
    },
  });
  // Keep the app on the client origin; open everything else in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== clientOrigin(CLIENT_URL)) event.preventDefault();
  });
  await win.loadURL(CLIENT_URL);
}

app.whenReady().then(async () => {
  try {
    await createWindow();
  } catch (error) {
    dialog.showErrorBox("Could not start", error instanceof Error ? error.message : String(error));
    app.quit();
  }
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", stopEngine);
process.on("exit", stopEngine);
