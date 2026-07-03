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
| `tasks` | id, type, title, status, parent_project, due_date, scheduled_date, scheduled_time, notes, date_added, blocked, blocked_reason, tags (jsonb), backlog_entered_at, `later_count` (int, default 0 — Inbox Review "bumped N×"; migration `add_later_count_to_tasks`), `day_order` (numeric — Week view within-day priority), `time_spent` (int default 0 — Focus minutes; migration `add_day_order_and_time_spent`), `board_order` (numeric, nullable — Tasks board This Week/Done manual drag-reorder; migration `add_board_order_to_tasks`), `recurrence` (`null`\|`'rolling'`\|`'anchored'`, reworked from weekly/monthly/interval)/`recurrence_series_id`/`recurrence_weekdays` (jsonb, anchored-only optional default rule)/`recurrence_month_day`/`recurrence_interval_n`/`recurrence_interval_unit` (migration `add_recurrence_to_tasks_and_archive`), `recurrence_lead_days` (int, nullable — anchored-only due-soon window; migration `rework_recurrence_rolling_anchored`), user_id — see [recurring-tasks rule](./recurring-tasks.md) | 46 rows |
| `archive` | same as tasks + original_status, archived_at, subtasks, `time_spent` (int default 0), `recurrence` (`null`\|`'rolling'`\|`'anchored'`)/`recurrence_series_id` (migration `add_recurrence_to_tasks_and_archive`; no lead-days/weekday/month-day granularity — lean history subset) | 47 rows |
| `tags` | user_id (PK), name (PK), color_slot, `sort_order` (int, nullable — Projects canvas column drag-order; migration `add_sort_order_to_tags`), created_at | 1 row |
| `commitments` | composite PK (user_id, id); title, date, start_time, end_time, **end_date** (date — cross-midnight), type (legacy, no longer written), **shift** (text: `'day'`\|`'night'`\|`'morning'`\|`'evening'` — migration `add_shift_to_commitments`), color_slot, notes, created_at — Week-view fixed-shift "busy" blocks (migrations `create_commitments_table`, `add_end_date_and_type_to_commitments`, `add_shift_to_commitments`) | 5 rows |

## Gotchas

- `archive.blocked`, `archive.tags`, and `archive.subtasks` are stored as `text` (not `boolean`/`jsonb`) — inconsistent with the `projects` and `tasks` tables. Keep this in mind if querying or inserting archive rows directly.
- All RLS policies scope rows by `auth.uid() = user_id`. MCP `execute_sql` runs as the service role and bypasses RLS — be careful with destructive queries.
