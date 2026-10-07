# Automations

Automations are per-project rules: **when** something happens, **if** the ticket matches your
conditions, **then** run actions. Owners and moderators manage them in **Project settings →
Automations**.

## Building a rule

- **When (trigger)** – one of: ticket created, ticket edited, status / priority / assignee
  changed, label added / removed, comment added, ticket reopened, ticket completed, vote threshold
  reached (you choose the number), added to a release, added to a milestone, release published,
  GitHub pull request linked, GitHub pull request merged.
- **If (conditions)** – optional. Conditions inside a group must all match (**AND**); a rule
  matches when any group matches (**OR**), e.g. _(type is Bug AND priority is Critical) OR label
  has Security_. Up to 5 groups of 10 conditions.

  Fields: type, status, priority, assignee, reporter, label, milestone, release, votes, has
  attachment, submitted via widget, project, title contains, description contains, ticket age
  (days) and reporter role (project owner, moderator, member, administrator, not a member).

- **Then (actions)** – up to 10, run in order: change status (with an optional note), change
  priority, assign to (a staff member or the project owner), clear assignee, add / remove label,
  add to / remove from milestone or release, add follower, add internal note, send a notification
  (to the assignee, reporter, project owners, project staff, followers or a project member), send
  to a Discord channel or webhook of the project (rules with this action can only be saved by
  owners), add a public comment (shown as _Automated_). Notifications and followers are limited to
  people of the project.
  Automations can't delete anything.

Rules run in a fixed order (their position, then creation order). New rules and rules created
from **templates** start **disabled** – review them, then switch them on.

### Templates

- **Critical bug handling** – assign the project owner and add a _Needs review_ label.
- **Popular feature request** – at 10 votes, add _Popular_ and notify staff.
- **Complete on pull request merge** – mark the ticket completed and comment.
- **In progress when a pull request is linked** – move open/planned tickets to In Progress.

## Test a rule (dry run)

The editor's **Test this rule** panel runs the rule as currently edited (also unsaved changes)
against a ticket you pick and shows which conditions pass and what each action would do. The test
runs inside a transaction that is always rolled back: nothing is changed, nobody is notified and
no webhook is sent.

## How rules run

- Events are queued in the same SQLite queue as email and webhooks (`outbound_jobs`, kind
  `automation`) inside the transaction of the original change. The original action is never
  slowed down or broken by an automation: if a rule fails, the change that triggered it stays.
- Each rule runs in its own transaction: a rule whose action fails is rolled back entirely
  (no half-applied rules) and recorded as **Failed**; the other rules still run.
- Changes are made through the same services as the web app – permissions, workflow rules
  (allowed transitions, required notes), notifications, webhooks and Discord all apply. The
  ticket history shows them as made by _Automation: <rule name>_.
- Rules are re-validated when they run: a deleted label, a member who left or a disabled status
  makes that action fail with a clear message instead of doing something unexpected. References
  to other projects are rejected on save and at run time.

### Loop prevention

A change made by an automation can trigger further rules (a _chain_). To prevent loops:

- a rule runs **at most once per chain**,
- chains stop after **5 levels** (later runs are recorded as **Skipped** with the reason), and
- one change causes at most **50 automated events** in total, however many rules react to each
  other (further events are dropped and the intervention is shown in the history).

A project can have at most 50 automations.

Each event is processed once per rule (unique run per event and rule), so retries after a crash
never apply a rule twice.

## Health and history

The Automations page starts with a compact summary: enabled and disabled rules, runs and failed
runs in the last 24 hours, how often a safety limit intervened, and the last failure.

**Automations → History** lists recent runs with filters (rule, result, ticket, date range, and
_Stopped by a safety limit_). Each run shows:

- rule, trigger, ticket, time, duration and chain depth;
- **how each condition evaluated** (passed / not passed, with names instead of ids);
- the actions **attempted** (changed, unchanged or failed) and those **not run** because an earlier
  action failed;
- the error summary (URLs, tokens and long secrets are removed);
- whether **loop protection, the depth limit or the 50-event safety limit** intervened.

When the 50-event limit stops a chain, one entry _Automation stopped after reaching the 50-event
safety limit._ is added to the history (staff only, not a notification), so rules that keep
triggering each other can be found. Runs are kept for 90 days.

## Permissions

| Who       | Can                                                          |
| --------- | ------------------------------------------------------------ |
| Owner     | Create, edit, enable/disable, delete, test, view history     |
| Moderator | Same as owner (automations only, not other project settings) |
| Member    | Nothing (sees automated changes on tickets like any change)  |
