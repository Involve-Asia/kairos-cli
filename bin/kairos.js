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

function openBrowser(url) {
  // Never via a shell. On Windows `start` is a cmd.exe builtin, and cmd treats
  // `&` as a command separator -- so the URL arrives at the browser truncated at
  // the first query parameter and the approval page sees no port. rundll32 is a
  // real executable and takes the URL as one opaque argument.
  const [cmd, args] = process.platform === "darwin"
    ? ["open", [url]]
    : process.platform === "win32"
      ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
      : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    // spawn reports a missing binary asynchronously; unhandled it would take
    // down the CLI mid-login instead of falling back to the printed link.
    child.on("error", () => info("Could not open a browser -- paste the link above."));
    child.unref();
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
//
// Claude and Cursor sign in to Kairos themselves (OAuth): no token is ever
// written for them. Claude's connector is account-wide -- added once in
// Settings → Connectors it serves the web, desktop, mobile and Claude Code
// signed in with the same account -- so setup points there instead of writing
// a second, token-based entry that would show every tool twice. Only clients
// that cannot sign in (Codex) get a personal token.

// No trailing slash: it must equal the resource Kairos declares for sign-in.
const MCP_URL = `${BASE}/mcp`;

function hasClaudeCode() {
  try { execFileSync("claude", ["--version"], { stdio: "ignore" }); return true; }
  catch { return false; }
}

function claudeConnectorSteps() {
  console.log(`\n${c.bold("Claude")} ${c.dim("— once, for web, desktop, mobile and Claude Code")}`);
  info("1. In Claude, open Settings → Connectors → Add custom connector.");
  info(`2. Name it Kairos, URL ${c.bold(MCP_URL)} — leave Advanced settings empty.`);
  info("3. Click Connect, then Allow on the Kairos page. No token involved.");
}

function installClaudeCodeSignIn() {
  // Replaces any earlier kairos-data entry, including a token-based one.
  try {
    execFileSync("claude", ["mcp", "remove", SERVER_NAME, "-s", "user"], { stdio: "ignore" });
  } catch { /* not previously installed */ }
  execFileSync("claude", ["mcp", "add", "--transport", "http", "-s", "user", SERVER_NAME, MCP_URL],
               { stdio: "ignore" });
  ok(`Claude Code ${c.dim(`${SERVER_NAME} → ${MCP_URL}`)}`);
  const finish = `in Claude Code run /mcp, choose ${SERVER_NAME} and Authenticate — or run ` +
                 `\`claude mcp login ${SERVER_NAME}\` in a terminal`;
  // `claude mcp login` needs an interactive terminal; run by an assistant it
  // has none, so say how to finish instead of failing.
  if (!process.stdin.isTTY) { info(`To sign in: ${finish}.`); return; }
  info("Signing in — your browser opens on the Kairos Allow page.");
  try {
    execFileSync("claude", ["mcp", "login", SERVER_NAME], { stdio: "inherit" });
  } catch {
    info(`Sign-in didn't finish. To retry: ${finish}.`);
  }
}

function codexPresent() {
  return fs.existsSync(path.join(os.homedir(), ".codex"));
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

async function ensureToken() {
  // Only token-based clients need this. Verify a stored token before reusing
  // it: a revoked or expired one would otherwise be installed silently.
  const cfg = readConfig();
  if (cfg.token) {
    const res = await fetch(`${BASE}/api/v1/cli/whoami/`, {
      headers: { Authorization: `Bearer ${cfg.token}` },
    }).catch(() => null);
    if (res && res.ok) {
      const b = await res.json();
      ok(`Signed in as ${c.bold(b.email)}`);
      return readConfig().token;
    }
    info(c.dim("Stored sign-in is no longer valid — signing in again."));
  }
  await authLogin();
  return readConfig().token;
}

async function installCodexWithToken() {
  const token = await ensureToken();
  const codex = installCodex(token, MCP_URL);
  if (codex.ok) {
    ok(`Codex ${c.dim(codex.file)}`);
    if (codex.needsEnv) info(c.dim(`Add to your shell: export KAIROS_MCP_TOKEN=${token.slice(0, 12)}…`));
  }
}

async function mcpInstall() {
  const claudeCode = process.argv.includes("--claude-code");
  console.log(`\n${c.bold("Connecting your assistants to Kairos")}`);
  claudeConnectorSteps();

  if (claudeCode) {
    if (!hasClaudeCode()) die("--claude-code given, but the claude command was not found.");
    console.log();
    installClaudeCodeSignIn();
  } else if (hasClaudeCode()) {
    info(c.dim("Claude Code on an API key instead of a Claude account? Run: kairos setup --claude-code"));
  }

  if (codexPresent()) {
    console.log(`\n${c.bold("Codex")} ${c.dim("— signs in with a personal token")}`);
    await installCodexWithToken();
  }

  const legacy = findLegacyInstalls();
  if (legacy.length) {
    console.log(`\n${c.bold("Older token-based entries found")}`);
    for (const l of legacy) info(`• ${l.where}`);
    info("With the Claude connector added, these make every Kairos tool appear twice.");
    info(`Once the connector works, run ${c.bold("kairos cleanup")} to remove them.`);
  }
}

// --- cleanup ----------------------------------------------------------------
//
// Earlier versions wrote a personal token into Claude Code and Claude Desktop.
// Only the entries this CLI created are touched: the kairos-data name with a
// Kairos token in it. Anything else is left alone.

function desktopConfigPath() {
  if (process.platform === "darwin")
    return path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  if (process.platform === "win32")
    return path.join(process.env.APPDATA || "", "Claude", "claude_desktop_config.json");
  return path.join(os.homedir(), ".config", "Claude", "claude_desktop_config.json");
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function hasKairosToken(entry) {
  return JSON.stringify(entry || {}).includes("Bearer kai_mcp_");
}

function findLegacyInstalls() {
  const found = [];
  const code = readJson(path.join(os.homedir(), ".claude.json"));
  if (code && code.mcpServers && hasKairosToken(code.mcpServers[SERVER_NAME]))
    found.push({ kind: "claude-code", where: `Claude Code: ${SERVER_NAME} (token in ~/.claude.json)` });
  const desktopFile = desktopConfigPath();
  const desktop = readJson(desktopFile);
  if (desktop && desktop.mcpServers && hasKairosToken(desktop.mcpServers[SERVER_NAME]))
    found.push({ kind: "claude-desktop", file: desktopFile,
                 where: `Claude Desktop: ${SERVER_NAME} (token in ${desktopFile})` });
  return found;
}

function cleanup() {
  const legacy = findLegacyInstalls();
  if (!legacy.length) { ok("No older token-based Kairos entries found."); return; }
  console.log(`\n${c.bold("Removing older token-based Kairos entries")}\n`);
  for (const l of legacy) {
    if (l.kind === "claude-code") {
      execFileSync("claude", ["mcp", "remove", SERVER_NAME, "-s", "user"], { stdio: "ignore" });
      ok("Claude Code");
    } else {
      const cfg = readJson(l.file);
      fs.copyFileSync(l.file, `${l.file}.bak-${Date.now()}`);
      delete cfg.mcpServers[SERVER_NAME];
      fs.writeFileSync(l.file, JSON.stringify(cfg, null, 2) + "\n");
      ok(`Claude Desktop ${c.dim("(backup kept next to the file)")}`);
      info(c.dim("Quit Claude Desktop fully (Cmd-Q) and reopen."));
    }
  }
  info(`The token itself still exists — revoke it at ${BASE}/data-access if nothing else uses it.`);
  console.log();
}

// --- setup ----------------------------------------------------------------

async function setup() {
  await mcpInstall();
  try {
    skillsInstall();
  } catch (e) {
    // Skills are guidance, not plumbing: failing to install them must not make
    // a successful connection look like a failure.
    info(c.dim(`Skills not installed (${e.message}). Run: kairos skills install`));
  }
}

// --- skills ---------------------------------------------------------------

const SKILL_NAMES = ["kairos-data-analysis", "kairos-work"];

function skillTargets() {
  // Claude Code reads ~/.claude/skills; Codex reads ~/.codex/skills. Install to
  // whichever exist rather than creating homes for tools that are not there.
  const out = [];
  for (const [dir, label] of [[".claude", "Claude Code"], [".codex", "Codex"]]) {
    const base = path.join(os.homedir(), dir);
    if (fs.existsSync(base)) out.push({ dir: path.join(base, "skills"), label });
  }
  return out;
}

function skillsInstall() {
  // Shipped inside this package, so the version of the guidance always matches
  // the version of the CLI that installed it.
  const source = path.join(__dirname, "..", "skills");
  if (!fs.existsSync(source)) die("This build has no skills directory.");

  const targets = skillTargets();
  if (!targets.length) {
    die("Neither ~/.claude nor ~/.codex exists — nothing to install into.\n" +
        "Run your assistant once first, then try again.");
  }

  console.log(`\n${c.bold("Installing Kairos skills")}\n`);
  for (const target of targets) {
    for (const name of SKILL_NAMES) {
      const from = path.join(source, name);
      if (!fs.existsSync(from)) continue;
      const to = path.join(target.dir, name);
      fs.mkdirSync(to, { recursive: true });
      fs.copyFileSync(path.join(from, "SKILL.md"), path.join(to, "SKILL.md"));
    }
    ok(`${target.label} ${c.dim(target.dir)}`);
  }
  info(c.dim("Re-run this after a CLI update to pick up revised guidance."));
  console.log(`\nRestart your assistant, then ask it something like:`);
  console.log(`  ${c.bold('"which publisher segments grew fastest last quarter?"')}\n`);
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

  kairos setup           connect your assistants (start here)
  kairos setup --claude-code
                         also add Kairos to Claude Code and sign in (for Claude
                         Code on an API key rather than a Claude account)
  kairos cleanup         remove token-based entries older versions created
  kairos auth login      get a personal token (for Codex and scripts)
  kairos auth status     show who you are and what you can read
  kairos auth logout     forget the local token
  kairos skills install  add the analysis and work-tracking guidance

Docs: ${BASE}/data-access
`;

(async () => {
  const [a, b] = process.argv.slice(2);
  try {
    if (a === "setup" || (!a && false)) return await setup();
    if (a === "auth" && b === "login") return await authLogin();
    if (a === "auth" && b === "status") return await authStatus();
    if (a === "auth" && b === "logout") return authLogout();
    if (a === "mcp" && b === "install") return await mcpInstall();
    if (a === "cleanup") return cleanup();
    if (a === "skills" && b === "install") return skillsInstall();
    console.log(USAGE);
  } catch (e) {
    die(e.message || String(e));
  }
})();
