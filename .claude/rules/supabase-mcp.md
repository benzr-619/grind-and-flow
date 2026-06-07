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
| `tasks` | id, type, title, status, parent_project, due_date, scheduled_date, scheduled_time, notes, date_added, blocked, blocked_reason, tags (jsonb), backlog_entered_at, user_id | 21 rows |
| `archive` | same as tasks + original_status, archived_at, subtasks | 5 rows |
| `tags` | user_id (PK), name (PK), color_slot, created_at | 1 row |

## Gotchas

- `archive.blocked`, `archive.tags`, and `archive.subtasks` are stored as `text` (not `boolean`/`jsonb`) — inconsistent with the `projects` and `tasks` tables. Keep this in mind if querying or inserting archive rows directly.
- All RLS policies scope rows by `auth.uid() = user_id`. MCP `execute_sql` runs as the service role and bypasses RLS — be careful with destructive queries.
