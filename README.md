# Kairos CLI

Connects an AI assistant to data through Kairos.

```bash
npx github:Involve-Asia/kairos-cli setup
```

**Claude and Cursor don't need this.** They sign in to Kairos themselves:

- **Claude** (web, desktop, mobile, and Claude Code signed in with the same
  account): Settings → Connectors → Add custom connector, URL
  `https://kairos.invol.asia/mcp`, leave Advanced settings empty, then Connect
  and Allow. One connector, everywhere, no token.
- **Cursor**: add `{"mcpServers": {"kairos": {"url": "https://kairos.invol.asia/mcp"}}}`
  to `~/.cursor/mcp.json`; Cursor asks you to sign in.

A connection lasts three months; Kairos reminds you daily for the last five,
with the steps to renew.

`setup` prints those Claude steps, connects **Codex** (which cannot sign in, so
it gets a personal token), installs the skills, and tells you about any older
token-based entries it finds.

Prefer to keep it around?

```bash
npm i -g github:Involve-Asia/kairos-cli
kairos setup
```

## Commands

| | |
|---|---|
| `kairos setup` | Connect your assistants — start here |
| `kairos setup --claude-code` | Also add Kairos to Claude Code and sign in, for Claude Code on an API key rather than a Claude account |
| `kairos cleanup` | Remove the token-based entries older versions wrote into Claude Code and Claude Desktop |
| `kairos auth login` | Get a personal token (for Codex and scripts) |
| `kairos auth status` | Who you are, and what data you can read |
| `kairos auth logout` | Forget the local token |
| `kairos skills install` | Add the analysis and work-tracking guidance |

## Upgrading from an earlier version

Earlier versions wrote a personal token into Claude Code and Claude Desktop.
With the Claude connector added as well, every Kairos tool then appears twice.
Add the connector, check it works, then run `kairos cleanup`. It removes only
the `kairos-data` entries that carry a Kairos token, backs up the Desktop config
first, and leaves everything else alone. Revoke the old token at
[/data-access](https://kairos.invol.asia/data-access) afterwards.

## How sign-in works

**Claude, Cursor, `--claude-code`:** OAuth. The app opens a Kairos page, you
click Allow, and it gets a short-lived token it renews itself for three months.
Nothing is copied or stored by this CLI.

**Codex (`auth login`):** starts a listener on a random loopback port and opens
Kairos in your browser. You approve there, in the session you already have. What
comes back through the browser is a **one-time code**, not a token — the CLI
trades that code for a token server-to-server. The token never appears in your
browser history, an address bar or a screenshot. It is written to
`~/.kairos/config.json` with mode `600` and nowhere else, lasts 90 days, and
carries exactly the data access you already had. Revoke it any time at
[/data-access](https://kairos.invol.asia/data-access).

## What it configures

- **Claude Code** (only with `--claude-code`) — `claude mcp add --transport http`
  with the URL alone, then `claude mcp login`. The sign-in needs an interactive
  terminal; run from an assistant it tells you to finish with `/mcp` →
  Authenticate instead.
- **Codex** — appends an `[mcp_servers.kairos-data]` block to
  `~/.codex/config.toml`. Set `KAIROS_MCP_TOKEN` in your shell for it.
- **Claude Desktop** — nothing: it uses the connector from your Claude account.

Restart the assistant afterwards, then ask it
*"what Kairos tools do you have?"*

## Skills

`setup` also installs two skills into `~/.claude/skills` and `~/.codex/skills`:

- **kairos-data-analysis** — business vs technical analysis, keeping queries
  cheap, judging whether a difference is real, and what may never leave the
  warehouse.
- **kairos-work** — reading work items and logging progress back.

They carry method only. Facts about your data — which tables exist, how they are
partitioned, what is known to be wrong with them — reach an assistant through the
MCP server, authenticated, and only for what that person may read.

**This repository is public, so it must never name a table, column, database or
business rule.** Anything of that sort belongs in the MCP server.

## Requirements

Node 18 or newer. No dependencies — the whole thing is one file.
