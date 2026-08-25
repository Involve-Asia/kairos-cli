#!/usr/bin/env node
/**
 * Kairos CLI — connects an AI assistant to company data.
 *
 * Deliberately dependency-free. Every install problem this replaces came from
 * an environment mismatch, so adding a dependency tree would reintroduce the
 * class of failure it exists to remove. Node 18+ ships fetch and that is all
 * this needs.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { execFileSync, spawn } = require("child_process");

const BASE = process.env.KAIROS_URL || "https://kairos.invol.asia";
const CONFIG_DIR = path.join(os.homedir(), ".kairos");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const SERVER_NAME = "kairos-data";

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};
const ok = (s) => console.log(`${c.green("✓")} ${s}`);
const info = (s) => console.log(`  ${s}`);
const die = (s) => { console.error(`\n${c.red("✗")} ${s}\n`); process.exit(1); };

// --- config ---------------------------------------------------------------

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); } catch { return {}; }
}
function writeConfig(cfg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  // 600 before writing, not after: a world-readable moment is still a leak.
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
  fs.chmodSync(CONFIG_FILE, 0o600);
}
function requireToken() {
  const { token } = readConfig();
  if (!token) die("Not signed in. Run `kairos auth login` first.");
  return token;
}

function openBrowser(url) {
  const cmd = process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(cmd, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" })
      .unref();
    return true;
  } catch { return false; }
}

// --- auth login -----------------------------------------------------------

async function authLogin() {
  const state = crypto.randomBytes(24).toString("base64url");
  const label = `${os.userInfo().username}@${os.hostname()}`;

  const { server, port } = await listen();
  const url = `${BASE}/cli/authorize?state=${encodeURIComponent(state)}`
    + `&port=${port}&label=${encodeURIComponent(label)}`;

  console.log(`\n${c.bold("Sign in to Kairos")}\n`);
  info("Opening your browser. Approve the request there.");
  info(c.dim(url));
  console.log();
  if (!openBrowser(url)) info("Could not open a browser — paste the link above.");

  const result = await Promise.race([
    waitForCode(server, state),
    // Bounded so a closed tab ends the command instead of hanging a terminal.
    new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), 180000)),
  ]).finally(() => server.close());

  const res = await fetch(`${BASE}/api/v1/cli/exchange/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: result.code, state }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) die(body?.error?.message || `Exchange failed (${res.status}).`);

  writeConfig({ token: body.token, email: body.email, url: BASE, mcp_url: body.mcp_url });
  console.log();
  ok(`Signed in as ${c.bold(body.email)}`);
  info(c.dim(`Token stored in ${CONFIG_FILE} (readable only by you)`));
  console.log();
}

function listen() {
  return new Promise((resolve) => {
    const server = http.createServer();
    // Port 0 lets the OS pick a free one; loopback only, so nothing off-machine
    // can reach the listener even briefly.
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

function waitForCode(server, expectedState) {
  return new Promise((resolve, reject) => {
    server.on("request", (req, res) => {
      const u = new URL(req.url, "http://127.0.0.1");
      if (u.pathname !== "/callback") { res.writeHead(404).end(); return; }
      const code = u.searchParams.get("code");
      const state = u.searchParams.get("state");
      const page = (title, msg) =>
        `<!doctype html><meta charset="utf-8"><title>${title}</title>`
        + `<body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#FAFAF8">`
        + `<div style="text-align:center"><h1 style="color:#0F1C2E;font-size:20px">${title}</h1>`
        + `<p style="color:#706F6B;font-size:14px">${msg}</p></div>`;

      if (!code || state !== expectedState) {
        res.writeHead(400, { "Content-Type": "text/html" })
           .end(page("Something went wrong", "Close this and run the command again."));
        reject(new Error("state mismatch"));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" })
         .end(page("You're signed in", "Return to your terminal — this tab can be closed."));
      resolve({ code });
    });
  });
}

// --- mcp install ----------------------------------------------------------

function hasClaudeCode() {
  try { execFileSync("claude", ["--version"], { stdio: "ignore" }); return true; }
  catch { return false; }
}

function installClaudeCode(token, mcpUrl) {
  try {
    execFileSync("claude", ["mcp", "remove", SERVER_NAME, "-s", "user"], { stdio: "ignore" });
  } catch { /* not previously installed */ }
  execFileSync("claude", [
    "mcp", "add", "--transport", "http", "-s", "user",
    SERVER_NAME, mcpUrl, "--header", `Authorization: Bearer ${token}`,
  ], { stdio: "ignore" });
  return true;
}

function desktopConfigPath() {
  if (process.platform === "darwin")
    return path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  if (process.platform === "win32")
    return path.join(process.env.APPDATA || "", "Claude", "claude_desktop_config.json");
  return path.join(os.homedir(), ".config", "Claude", "claude_desktop_config.json");
}

function bestNode() {
  // Claude Desktop launches with its own PATH and takes the first node it
  // finds, which on a machine with several versions is often too old. Resolve
  // an absolute path to one that actually works.
  const candidates = [];
  const nvm = path.join(os.homedir(), ".nvm", "versions", "node");
  for (const dir of [nvm]) {
    try { for (const v of fs.readdirSync(dir)) candidates.push(path.join(dir, v, "bin")); }
    catch { /* not installed */ }
  }
  candidates.push("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", path.dirname(process.execPath));
  let best = null, bestMajor = 0;
  for (const dir of candidates) {
    const node = path.join(dir, process.platform === "win32" ? "node.exe" : "node");
    if (!fs.existsSync(node)) continue;
    try {
      const v = execFileSync(node, ["--version"], { encoding: "utf8" }).trim();
      const major = parseInt(v.replace(/^v/, ""), 10);
      if (major >= 18 && major > bestMajor) { best = dir; bestMajor = major; }
    } catch { /* unusable */ }
  }
  return best;
}

function installClaudeDesktop(token, mcpUrl) {
  const file = desktopConfigPath();
  const nodeDir = bestNode();
  if (!nodeDir) return { ok: false, why: "no Node 18+ found for the stdio bridge" };

  let cfg = {};
  if (fs.existsSync(file)) {
    try { cfg = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch { return { ok: false, why: `${file} is not valid JSON — fix or remove it` }; }
    fs.copyFileSync(file, `${file}.bak-${Date.now()}`);
  }
  if (!cfg.mcpServers || typeof cfg.mcpServers !== "object") cfg.mcpServers = {};

  // Repair the nesting people hit when pasting a whole config into an existing
  // mcpServers block; an entry one level too deep is silently skipped.
  const inner = cfg.mcpServers.mcpServers;
  if (inner && typeof inner === "object" && !inner.command) {
    delete cfg.mcpServers.mcpServers;
    Object.assign(cfg.mcpServers, inner);
  }

  cfg.mcpServers[SERVER_NAME] = {
    command: path.join(nodeDir, process.platform === "win32" ? "npx.cmd" : "npx"),
    args: ["-y", "mcp-remote@latest", mcpUrl,
           // The value contains a space after "Bearer", which does not survive
           // argument parsing — hence the env indirection.
           "--header", "Authorization:${MCP_TOKEN}", "--transport", "http-only"],
    env: {
      MCP_TOKEN: `Bearer ${token}`,
      PATH: `${nodeDir}${path.delimiter}/usr/local/bin${path.delimiter}/usr/bin${path.delimiter}/bin`,
    },
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
  return { ok: true, file };
}

function installCodex(token, mcpUrl) {
  const file = path.join(os.homedir(), ".codex", "config.toml");
  if (!fs.existsSync(path.dirname(file))) return { ok: false, why: "Codex not installed" };
  let toml = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (toml.includes(`[mcp_servers.${SERVER_NAME}]`)) return { ok: true, file, already: true };
  toml += `\n[mcp_servers.${SERVER_NAME}]\nurl = "${mcpUrl}"\n`
        + `bearer_token_env_var = "KAIROS_MCP_TOKEN"\n`;
  fs.writeFileSync(file, toml);
  return { ok: true, file, needsEnv: true };
}

function mcpInstall() {
  const cfg = readConfig();
  const token = requireToken();
  const mcpUrl = cfg.mcp_url || `${BASE}/mcp/`;
  console.log(`\n${c.bold("Installing the Kairos data connector")}\n`);
  let any = false;

  if (hasClaudeCode()) {
    try { installClaudeCode(token, mcpUrl); ok("Claude Code"); any = true; }
    catch (e) { info(c.red(`Claude Code: ${e.message.split("\n")[0]}`)); }
  } else {
    info(c.dim("Claude Code — not found, skipped"));
  }

  const desktop = installClaudeDesktop(token, mcpUrl);
  if (desktop.ok) {
    ok(`Claude Desktop ${c.dim(desktop.file)}`);
    info(c.dim("Quit Claude Desktop fully (Cmd-Q) and reopen for it to load."));
    any = true;
  } else {
    info(c.dim(`Claude Desktop — skipped (${desktop.why})`));
  }

  const codex = installCodex(token, mcpUrl);
  if (codex.ok) {
    ok(`Codex ${c.dim(codex.file)}`);
    if (codex.needsEnv) info(c.dim(`Add to your shell: export KAIROS_MCP_TOKEN=${token.slice(0, 12)}…`));
    any = true;
  }

  if (!any) die("No supported assistant found. Install Claude Code, Claude Desktop or Codex first.");
  console.log(`\nAsk it: ${c.bold('"what Kairos data tools do you have?"')}\n`);
}

// --- setup ----------------------------------------------------------------

async function setup() {
  const cfg = readConfig();
  if (cfg.token) {
    // Already signed in on this machine — verify before assuming, since a
    // revoked or expired token would otherwise be installed silently.
    const res = await fetch(`${BASE}/api/v1/cli/whoami/`, {
      headers: { Authorization: `Bearer ${cfg.token}` },
    }).catch(() => null);
    if (res && res.ok) {
      const b = await res.json();
      ok(`Already signed in as ${c.bold(b.email)}`);
      return mcpInstall();
    }
    info(c.dim("Stored sign-in is no longer valid — signing in again."));
  }
  await authLogin();
  mcpInstall();
}

// --- status / logout ------------------------------------------------------

async function authStatus() {
  const cfg = readConfig();
  if (!cfg.token) die("Not signed in. Run `kairos auth login`.");
  const res = await fetch(`${BASE}/api/v1/cli/whoami/`, {
    headers: { Authorization: `Bearer ${cfg.token}` },
  });
  if (res.status === 401) die("Your token is no longer valid. Run `kairos auth login` again.");
  const b = await res.json();
  console.log();
  ok(`Signed in as ${c.bold(b.email)}`);
  info(`Connectors: ${b.connectors.length ? b.connectors.join(", ") : c.dim("none granted yet")}`);
  info(`Tables:     ${b.tables}`);
  if (b.expires_at) info(c.dim(`Expires:    ${new Date(b.expires_at).toLocaleDateString()}`));
  console.log();
}

function authLogout() {
  try { fs.unlinkSync(CONFIG_FILE); } catch { /* already gone */ }
  ok("Signed out locally.");
  info(c.dim("The token still exists server-side — revoke it on /data-access to be certain."));
}

// --- entry ----------------------------------------------------------------

const USAGE = `
${c.bold("kairos")} — connect your AI assistant to company data

  kairos setup           sign in and connect your assistant (start here)
  kairos auth login      sign in through the browser
  kairos auth status     show who you are and what you can read
  kairos auth logout     forget the local token
  kairos mcp install     wire up Claude Code / Claude Desktop / Codex

Docs: ${BASE}/data-access
`;

(async () => {
  const [a, b] = process.argv.slice(2);
  try {
    if (a === "setup" || (!a && false)) return await setup();
    if (a === "auth" && b === "login") return await authLogin();
    if (a === "auth" && b === "status") return await authStatus();
    if (a === "auth" && b === "logout") return authLogout();
    if (a === "mcp" && b === "install") return mcpInstall();
    console.log(USAGE);
  } catch (e) {
    die(e.message || String(e));
  }
})();
