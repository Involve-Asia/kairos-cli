---
name: kairos-data-analysis
description: How to answer business questions with Kairos data — which tool to reach for, how to keep queries cheap, when a difference is real, and what may never leave the warehouse. Use whenever a question involves company data through the kairos-data MCP server.
---

# Analysing data through Kairos

## Start by finding out what you actually have

`list_tables` first, every time. You cannot discover tables any other way, and
guessing wastes a paid query. Then `describe_table` on anything you plan to use.

Read the `known_issues` field if it is there. Someone has already been caught by
that column and taken the trouble to write it down; you are being handed the
answer to a question you were about to pay to ask.

## Two lenses — pick one deliberately

Ask which is wanted if it isn't obvious. The same numbers support very different
answers, and producing the wrong kind is worse than producing none.

**Business analytics — "what is happening, and what should we do?"**
Segments, trends, concentration, contribution. Rank things. Find where the money
is and where it leaks. Answer in outcomes: revenue, margin, volume, retention.
Point at a decision. Most questions are this, and most people asking want this.

**Technical analytics — "is this real, and how sure are we?"**
Reach for it when a decision hinges on whether a difference is genuine:

- **Comparing two groups.** A difference in means needs a confidence interval,
  not just a point estimate. Report the interval; if it straddles zero, say the
  data does not distinguish them. With large n almost everything is
  "significant" — report effect size and let the reader judge whether it matters.
- **Before and after a change.** A raw pre/post comparison attributes every
  concurrent event to your change. Find a control group that was not exposed and
  compare the *change in differences*. If no control exists, say the estimate is
  confounded rather than quietly presenting it as causal.
- **Seasonality.** Weekly and monthly cycles are strong in most commercial data.
  Compare like periods — week on week, or the same weekday — before declaring a
  trend. A Tuesday-to-Sunday comparison is not a finding.
- **Ratios of small numbers.** A conversion rate over 30 events is noise. State
  the denominator every time you report a rate.
- **Survivorship.** Cohorts filtered to those who did something already exclude
  everyone who did not. Say so.

State your uncertainty in the answer. "Up 12%, though within normal weekly
variation" is a more useful sentence than "up 12%".

## Cost discipline

Queries are billed on **bytes scanned**, capped per query, and drawn from a
daily budget. Cheap habits:

- **Filter on partition keys.** `describe_table` names them. A partition filter
  is the difference between reading a day and reading a year.
- **Select the columns you need.** Columnar storage means unread columns cost
  nothing, so `SELECT *` on a wide table is pure waste.
- **Aggregate in SQL.** Never pull rows to count them.
- `COUNT(*)` alone is usually free — the format stores it.
- Explore on a narrow slice first, then widen once the shape is right.

`get_usage` shows what you have spent. If a query is refused for the scan limit,
narrow it rather than retrying.

## What must never leave

You may be able to read more than the person you are answering. That difference
is yours to manage: what you *can* see is not what you may *repeat*.

Never emit personal identifiers — email addresses, full names, phone numbers,
home addresses, bank or account numbers, identity-card or passport numbers, or
raw ids that single out one person.

This is judgement, not a word list. The test is whether a reader could pick out
an individual. Things that pass a naive filter and still fail that test: a
"top 10 by revenue" table where each row is one person; a segment narrowed until
three accounts remain; an id anyone with database access could resolve to a name.

Aggregate instead. **Suppress any group smaller than about 10 people.** Naming a
company, an advertiser or an offer is fine; naming a person is not. If a question
can only be answered by exposing individuals, say so and give the aggregate —
that is a complete answer, not a failure.

## Write it back

When you learn something durable about the data — a column that is empty before
some date, a replica that disagrees with its source, a metric that does not mean
what its name suggests — call `record_finding`. It is reviewed, and once approved
everyone describing that table is told. Record what you verified, not what you
assume, and put no personal data in the note.

## Answering

Lead with the answer, not the method. No SQL and no column names in prose — say
"publishers in the Philippines", not the predicate you used. Give numbers context:
"up 12% to 438,000" beats "438453". Be honest about limits; if the data cannot
answer the question, that *is* the answer, and it is more useful than a confident
number built on a bad assumption.
