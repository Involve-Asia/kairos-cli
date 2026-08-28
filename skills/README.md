# Kairos skills

Guidance for assistants connected to Kairos through the `kairos-data` MCP server.

    npx github:Involve-Asia/kairos-cli skills install

Two skills:

- **kairos-data-analysis** — choosing between business and technical analysis,
  keeping queries cheap, judging whether a difference is real, and what may never
  leave the warehouse.
- **kairos-work** — reading work items and logging progress back.

## Why this is separate from the MCP server

Method lives here; facts about your data live behind the token.

"Filter on the partition column" is method — it is true anywhere and safe to
publish. Which columns *your* tables are partitioned by is your schema, and it
reaches an assistant through `describe_table`, authenticated, only for tables
that person may read.

**This repository is public. It must never name a table, a column, a database,
or a business rule.** If a change would put any of those here, it belongs in the
MCP server instead.
