# Kairos CLI

Connects an AI assistant to data through Kairos.

```bash
npx github:Involve-Asia/kairos-cli setup
```

That is the whole thing. It signs you in through the browser and configures
whichever assistant you have. Restart the assistant afterwards.

Prefer to keep it around?

```bash
npm i -g github:Involve-Asia/kairos-cli
kairos setup
```

## Commands

| | |
|---|---|
| `kairos setup` | Sign in and connect — start here |
| `kairos auth login` | Sign in only |
| `kairos auth status` | Who you are, and what data you can read |
| `kairos auth logout` | Forget the local token |
| `kairos mcp install` | Wire up Claude Code, Claude Desktop and Codex |
| `kairos skills install` | Add the analysis and work-tracking guidance |

## How sign-in works

`auth login` starts a listener on a random loopback port and opens Kairos in
your browser. You approve there, in the session you already have. What comes
back through the browser is a **one-time code**, not a token — the CLI trades
that code for a token server-to-server.

The token therefore never appears in your browser history, in an address bar,
or in a screenshot. It is written to `~/.kairos/config.json` with mode `600`
and nowhere else. It carries exactly the data access you already had; approving
grants nothing new. Revoke it any time at
[/data-access](https://kairos.invol.asia/data-access).

## What `mcp install` does

- **Claude Code** — `claude mcp add --transport http`
- **Claude Desktop** — edits `claude_desktop_config.json`, backing it up first
  and leaving your other settings untouched. Claude Desktop only supports local
  (stdio) servers, so this configures the `mcp-remote` bridge, pinned to an
  absolute Node 18+ path because Desktop otherwise picks the first `node` on its
  PATH — often one too old to run it.
- **Codex** — appends an `[mcp_servers.kairos-data]` block to
  `~/.codex/config.toml`. Set `KAIROS_MCP_TOKEN` in your shell for it.

Whichever it configures, restart the assistant afterwards, then ask it
*"what Kairos data tools do you have?"*

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
