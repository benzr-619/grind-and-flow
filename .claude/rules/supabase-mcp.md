# Supabase MCP Access

The Supabase MCP connector is connected for this project. Always prefer it over manual SQL or asking the user to run migrations.

## Project details

| Key | Value |
|---|---|
| Project name | Grind and Flow |
| Project ID | `copzqbnjoakvcrvmedev` |
| Region | us-west-2 |
| DB host | `db.copzqbnjoakvcrvmedev.supabase.co` |
| Postgres | 17 |

## When to use MCP tools

- **Schema changes / migrations**: use `apply_migration` — never ask the user to run SQL manually.
- **Data inspection / debugging**: use `execute_sql` to query live data.
- **Verifying a migration landed**: use `list_tables` or `execute_sql`.
- **Checking table structure**: use `list_tables` with `verbose: true`.

## Confirmed table inventory (as of 2026-06-07)

All four app tables exist in the `public` schema with RLS enabled:

| Table | Key columns | Notes |
|---|---|---|
| `projects` | id, title, status, due_date, scheduled_date, scheduled_time, notes, date_added, blocked, blocked_reason, tags (jsonb), subtasks (jsonb), user_id, capacities_url, waiting, waiting_reason, waiting_auto | 35 rows |
| `tasks` | id, type, title, status, parent_project, due_date, scheduled_date, scheduled_time, notes, date_added, blocked, blocked_reason, tags (jsonb), backlog_entered_at, `later_count` (int, default 0 — Inbox Review "bumped N×"; migration `add_later_count_to_tasks`), `day_order` (numeric — Week view within-day priority), `time_spent` (int default 0 — Focus minutes; migration `add_day_order_and_time_spent`), user_id | 46 rows |
| `archive` | same as tasks + original_status, archived_at, subtasks, `time_spent` (int default 0) | 47 rows |
| `tags` | user_id (PK), name (PK), color_slot, created_at | 1 row |
| `commitments` | composite PK (user_id, id); title, date, start_time, end_time, **end_date** (date — cross-midnight), **type** (text: `'work'`\|`'exercise'`\|null), color_slot, notes, created_at — Week-view "busy" blocks (migrations `create_commitments_table`, `add_end_date_and_type_to_commitments`) | 0 rows |

## Gotchas

- `archive.blocked`, `archive.tags`, and `archive.subtasks` are stored as `text` (not `boolean`/`jsonb`) — inconsistent with the `projects` and `tasks` tables. Keep this in mind if querying or inserting archive rows directly.
- All RLS policies scope rows by `auth.uid() = user_id`. MCP `execute_sql` runs as the service role and bypasses RLS — be careful with destructive queries.
