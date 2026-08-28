---
name: kairos-work
description: Reading and updating work items — tasks, updates, attachments — through the kairos-data MCP server. Use when asked what the team is working on, what shipped, what is stalled, or when logging progress on a task.
---

# Working with Kairos work items

## Reading

`list_work` returns whole records: description, status, assignee, tags,
attachments and the full update history nested in each one. You do not need to
join anything.

- It defaults to **activity in the last 7 days**, where activity means the item
  was edited, or gained an update or an attachment. A task whose row has not
  changed in a month but was commented on yesterday is included, correctly.
- It returns **everything the person can see**, not only their own. Pass
  `assignee` for one person's work.
- `since` takes `7d`, `48h`, `2w`, an ISO date, or `all`.
- Bodies come back **in full**. Pass `truncate` when you only need an overview —
  fifty complete updates will bury the answer you are assembling.
- `get_work` returns one item, never truncated.

**Timestamps are already in the reader's timezone** and the response says which.
Use them as given. Do not convert, and do not assume UTC.

Every record carries a `url`. Cite it — "three tasks are stalled, here they are"
with links beats titles someone has to go and find.

## Writing

Three tools, and they need edit access on the item. Everything written this way
is tagged `via-assistant`, so it is clear later how it got there.

**`post_update`** — the one that earns its keep. Logging progress is the thing
people skip, and a tracker nobody updates is worse than none. Post one when work
has actually moved. Write what a colleague needs:

- what changed
- what it means — the consequence, not the commit
- what is next, or what is now blocked

Write it as the person would, in their voice, not as a report about them. Keep
it to what happened; do not invent detail to pad it out.

**`update_task`** records a fact — status, dates, priority, estimate, assignee.
It does not record *why*. If the reason matters, and for a status change it
usually does, post an update as well. A task that silently flips to done teaches
the next reader nothing.

**`create_task`** makes a draft, deliberately. Deciding that work exists is a
human call; propose it, let them confirm before it goes active.

## Judgement

Confirm before you write. "I'll log this on the recon task — here is the wording"
takes a second and prevents an update on the wrong item, which is tedious to
unpick and visible to everyone.

Do not bulk-update. If several items need changing, say which and why, and do
them one at a time with the person watching.

There is no delete. That is intentional. If something needs removing, it needs a
person in the browser.
