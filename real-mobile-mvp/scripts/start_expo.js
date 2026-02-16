/* eslint-disable no-console */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function majorVersion(v) {
  const m = String(v || "").replace(/^v/, "").split(".")[0];
  return Number(m || "0");
}

function pickNodeBin() {
  const currentMajor = majorVersion(process.version);
  const node20 = "/opt/homebrew/opt/node@20/bin/node";
  const node22 = "/opt/homebrew/opt/node@22/bin/node";

  // Expo SDK 54 is most stable on Node 20 on this workstation.
  if (currentMajor > 20) {
    if (fs.existsSync(node20)) return node20;
    if (fs.existsSync(node22)) return node22;
    console.error(`Node ${process.version} is too new for Expo in this workspace.`);
    console.error("Install Node 20 (Homebrew): brew install node@20");
    console.error('Or run with PATH="/opt/homebrew/opt/node@20/bin:$PATH".');
    process.exit(1);
  }

  return process.execPath;
}

function prefixPath(env, dir) {
  const sep = process.platform === "win32" ? ";" : ":";
  const current = env.PATH || "";
  if (current.split(sep).includes(dir)) return current;
  return `${dir}${sep}${current}`;
}

function main() {
  const cwd = process.cwd();
  const nodeBin = pickNodeBin();
  const npxBin = path.join(path.dirname(nodeBin), "npx");
  const args = process.argv.slice(2);

  const env = { ...process.env };
  // Expo CLI v54 has been flaky on this machine due to transitive deps (urql/undici/env loaders).
  // Telemetry also pulls in extra networking deps. Disable telemetry for local dev runs.
  env.EXPO_NO_TELEMETRY = env.EXPO_NO_TELEMETRY ?? "1";
  const nodeDir = path.dirname(nodeBin);
  if (fs.existsSync(nodeDir)) {
    env.PATH = prefixPath(env, nodeDir);
  }

  // Prefer invoking Expo via npx. On this workspace, invoking the local CLI entry
  // through Node has intermittently crashed with `TypeError: exec is not a function`.
  const child = spawn(fs.existsSync(npxBin) ? npxBin : "npx", ["expo", "start", ...args], {
    stdio: "inherit",
    cwd,
    env,
  });

  child.on("exit", (code, signal) => {
    if (signal) process.exit(1);
    process.exit(code ?? 1);
  });
}

main();
