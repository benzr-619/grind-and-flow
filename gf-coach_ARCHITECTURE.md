# ARCHITECTURE.md — G&F Coach

> Strategy + architecture spec for **G&F Coach**, a local AI planning and coaching
> agent that works alongside the Grind & Flow app. This file is the standing
> context document for the build. Read it before writing any code. The
> implementing model (Sonnet) should treat this as the source of truth for v1
> scope, structure, and invariants.

---

## 1. Purpose

A **local, single-user** desktop tool that runs a weekly reflection + planning
ritual (Tuesday mornings) and serves as an on-demand life/career coach. It:

1. Reads the Grind & Flow Supabase tables (projects, tasks, archive, tags).
2. Reads the user's clinical schedule from a ShiftAdmin iCal feed.
3. Reflects on the past week (what got done, from the `archive`) and proposes a
   prioritized plan for the coming week, assigning tasks/projects to specific
   days under the user's time constraints.
4. Takes agentic actions on G&F data — add subtasks, set due dates, set
   scheduled dates/times, append short notes — but **only after explicit
   in-session approval**.
5. Holds open-ended coaching conversations about goals, intentions, and
   long-term direction, and recognizes when a topic deserves a more capable
   frontier model, producing a ready-to-paste handoff prompt.
6. Improves over time by accumulating **memory** (intentions, reflections,
   learned preferences) that is retrieved into context — **not** by fine-tuning.

Everything runs on the user's machine. Nothing is hosted remotely. The codebase
is local-only (no GitHub, no cloud deploy).

---

## 2. v1 scope and non-goals

### In scope for v1
- Local Python service + local web UI (opened in a browser / standalone window).
- LM Studio backend (Qwen2.5-32B-Instruct Q4_K_M) via its OpenAI-compatible API.
- Read of all four G&F tables; write via a constrained tool layer with
  propose → approve → commit.
- ShiftAdmin iCal parsing + the user's fixed time-rules → a weekly day-assignment
  plan.
- File-based memory + retrieval.
- Weekly session flow + free-form coaching chat in one UI.
- Conversation-summary notes (append short notes to a project/task).
- Frontier-escalation handoff prompts.

### Explicitly NOT in v1
- No fine-tuning or LoRA training of the model. Adaptation is memory + prompt.
- No autonomous/unattended writes. A human approves every mutation.
- No multi-user, no auth UI — single user, local trust boundary.
- No packaging as a notarized native `.app` (see §16 on the "desktop feel"
  pragmatic path). A clean local web app is the v1 target.
- No two-way Capacities integration (out of scope; G&F owns that).
- No real-time sync with an open G&F browser tab (see §7.4 staleness note).

---

## 3. Runtime environment

- **Machine:** Apple Silicon MacBook Pro, 48 GB unified memory. Comfortably runs
  32B Q4_K_M (~20 GB) with a large context window and headroom. No need to drop
  to a smaller model.
- **Model host:** LM Studio running locally, serving the OpenAI-compatible API
  (default `http://localhost:1234/v1`). The user starts LM Studio and loads the
  model before launching the coach (the service should detect and warn if the
  endpoint is unreachable).
- **Language:** Python 3.11+.
- **Persistence:** Supabase (shared with G&F) for task data; local files for
  memory and config.

---

## 4. High-level architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Local web UI (browser / standalone window)                    │
│  - Weekly session view (review + approve proposals)            │
│  - Coaching chat view                                          │
└───────────────▲───────────────────────────┬──────────────────┘
                │ HTTP (localhost)           │
┌───────────────┴───────────────────────────▼──────────────────┐
│  Coach service (Python, FastAPI)                               │
│                                                                │
│  ┌────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │ Orchestr-  │  │ Tool registry │  │ Review/commit layer   │  │
│  │ ator       │──│ (read/propose │──│ (plain-language diff, │  │
│  │ (weekly +  │  │  /commit)     │  │  schema validation)   │  │
│  │  chat)     │  └──────┬────────┘  └──────────┬────────────┘  │
│  └─────┬──────┘         │                      │               │
│        │          ┌─────▼─────┐          ┌─────▼─────┐         │
│        │          │ Supabase  │          │ Memory     │         │
│        │          │ client    │          │ store      │         │
│        │          │ (keyed)   │          │ (files)    │         │
│        │          └───────────┘          └────────────┘         │
│   ┌────▼─────┐   ┌────────────┐                                │
│   │ LM Studio │   │ ShiftAdmin │                                │
│   │ client    │   │ iCal client│                                │
│   └───────────┘   └────────────┘                                │
└────────────────────────────────────────────────────────────────┘
        │                    │
   localhost:1234       webcal feed
```

**Key principle:** the LLM never holds credentials and never writes directly.
It emits structured **tool calls**; the service executes reads and stages
**proposals**; the user approves; the commit layer validates against the schema
and writes. Plain-language review on top, schema validation underneath.

---

## 5. Tech stack

| Concern | Choice | Notes |
|---|---|---|
| Service | Python 3.11+, **FastAPI** + Uvicorn | Local HTTP server |
| LLM client | OpenAI Python SDK pointed at LM Studio | `base_url=http://localhost:1234/v1`, dummy key |
| DB | `supabase-py` | Service/anon key in local config |
| iCal | `icalendar` + `recurring-ical-events` | Handles recurrence + timezones |
| Frontend | Static HTML/CSS/JS served by FastAPI | Single-page; no build step (mirrors G&F's ethos) |
| Config | `.env` + a local `config.toml` | Secrets never committed |
| Memory | Markdown/JSON files on disk | Plus optional Supabase `coach_memory` table later |

Keep the frontend buildless to match the user's preference and G&F's style.

---

## 6. Project structure

```
gf-coach/
├── ARCHITECTURE.md            # this file
├── README.md                  # local run instructions
├── config.example.toml        # template; real config.toml is gitignored/local
├── .env.example
├── run.sh                     # launches LM Studio check + uvicorn + opens browser
├── pyproject.toml
├── coach/
│   ├── __init__.py
│   ├── main.py                # FastAPI app, routes, startup checks
│   ├── config.py              # loads secrets + user time-rules
│   ├── llm.py                 # LM Studio client, chat loop, tool-call parsing
│   ├── tools.py               # tool registry (read/propose/commit functions)
│   ├── schema.py              # G&F schema contract + validators + field mappers
│   ├── supabase_io.py         # all Supabase reads/writes (the only DB module)
│   ├── schedule.py            # iCal fetch/parse + time-rule constraint model
│   ├── planner.py             # weekly context assembly + day-assignment logic
│   ├── memory.py              # load/save/retrieve memory
│   ├── review.py              # proposal → plain-language rendering + validation
│   └── orchestrator.py        # weekly session + chat orchestration
├── memory/                    # user memory store (local, gitignored)
│   ├── intentions.md          # north stars / long-term goals (user-authored)
│   ├── preferences.md         # learned working preferences
│   └── reflections/           # one file per weekly session, dated
└── web/
    ├── index.html
    ├── app.js
    └── style.css
```

`supabase_io.py` is the **only** module that touches Supabase — mirror G&F's
discipline of a single persistence module.

---

## 7. The G&F schema contract (invariants the agent MUST respect)

The coach writes to the same tables G&F uses. To avoid corrupting state, it must
honor G&F's conventions exactly. Encode these in `schema.py` as validators; the
commit layer rejects any proposal that violates them.

### 7.1 Field mappers (JS camelCase ↔ DB snake_case)
The DB uses snake_case. Replicate G&F's mapping when reading/writing.

**projects:** `id, title, status, due_date, scheduled_date, scheduled_time,
notes, date_added, blocked, blocked_reason, waiting, waiting_reason,
waiting_auto, tags (jsonb), subtasks (jsonb), capacities_url, user_id`

**tasks:** `id, type, title, status, parent_project, due_date, scheduled_date,
scheduled_time, notes, date_added, blocked, blocked_reason, tags (jsonb),
backlog_entered_at, user_id`

**archive:** tasks shape + `archived_at, original_status` (archived projects also
carry `subtasks`).

**tags:** `user_id, name, color_slot, created_at` (PK = `user_id, name`).

### 7.2 ID generation
- Task: `'t' + <epoch_ms>`
- Project: `'p' + <epoch_ms>`
- Subtask: `'st' + <epoch_ms>`
Use real millisecond timestamps; never reuse or fabricate non-conforming IDs.

### 7.3 Enumerations and special logic
- **Task status:** `backlog | this-week | next | doing | done`. The coach should
  generally not move items to `doing` (that's the live focus zone) or `done`
  (completion is the user's act). It schedules within `backlog/this-week/next`.
- **Project status:** `active | up-next | on-hold | someday`.
- **Task type:** `standalone | task` (`task` = linked to a project via
  `parent_project`).
- **`backlog_entered_at`:** set when an item enters backlog; drives the age
  counter. If the coach moves an item into backlog, set this; do not clobber it
  on unrelated edits.
- **Waiting / waitingAuto (projects):** `waiting` auto-sets true when a linked
  task is blocked and auto-clears when all linked blocked tasks resolve;
  `waiting_auto=true` means automatic, `false` means a manual (sticky) waiting
  state. **v1 rule:** the coach does NOT manipulate `waiting`/`waiting_auto`
  directly — that logic is owned by G&F. Treat these as read-only.
- **Subtask object:** `{ id, title, done, promoted, loc, promotedTaskId? }`. When
  adding a subtask, append to the `subtasks` jsonb array with `done:false,
  promoted:false` and a valid `st…` id.
- **Tags:** built-in tags `work | personal | school` are hardcoded in G&F and
  only appear in the `tags` table if recolored. The coach may apply existing
  tags; creating brand-new tags is allowed but should be surfaced clearly in the
  proposal.

### 7.4 Staleness / concurrency note
G&F uses **optimistic in-memory state** and writes to Supabase in the
background. If G&F is open in a browser while the coach writes directly to the
DB, the browser holds stale state and may overwrite the coach's changes on its
next background write. **v1 guidance:** run the weekly session with G&F closed,
and reload G&F afterward to pull the coach's changes. The UI should remind the
user of this at session start. (A future version could write through a small G&F
API or use Supabase realtime; out of scope for v1.)

---

## 8. Tool registry

The model interacts with G&F only through these tools (function-calling). Keep
names and schemas stable; document each in `tools.py`. Split into **read**
(execute immediately) and **mutating** (stage a proposal — never write directly).

### Read tools (immediate)
- `get_projects(filter?)` → projects, optionally by status/tag.
- `get_tasks(filter?)` → tasks, optionally by status/project/tag.
- `get_archive(since?)` → archived items (default: last 14 days) for reflection.
- `get_tags()` → available tags.
- `get_schedule(week_start)` → parsed clinical shifts + computed free/admin/
  protected blocks for the week (see §10).
- `get_memory(query?)` → retrieved intentions/preferences/past reflections.

### Mutating tools (stage proposals only)
- `propose_add_subtask(project_id, title)`
- `propose_set_due_date(item_type, id, date)`
- `propose_set_scheduled(item_type, id, date, time?)`
- `propose_set_status(item_type, id, status)`  *(constrained per §7.3)*
- `propose_append_note(item_type, id, text)`
- `propose_add_task(title, type, parent_project?, status, tags?, …)`

Each `propose_*` call returns a staged change object (not a DB write). The
orchestrator collects them into a **proposal set** for review. There is no
`commit` tool exposed to the model — commit is a human-triggered action in the
UI, executed by the service after validation.

---

## 9. Propose → approve → commit (write safety)

This is the core safety mechanism and must be **plain-language end to end.** The
user never needs to read SQL or JSON.

1. **Stage.** Model emits `propose_*` tool calls. Service stores them.
2. **Render.** `review.py` turns each staged change into one human sentence plus
   a before→after where relevant, e.g.:
   - *"Add subtask 'Draft IRB section' to project **Neuro-study**."*
   - *"Set due date of task **Submit reimbursement** to **Fri Jun 12** (was: none)."*
   - *"Append note to **Grant-app**: 'Scoped to phase 1 only per 6/4 discussion.'"*
3. **Review.** UI shows the list with per-item Approve / Edit / Skip, and a
   "why" line from the model (its reasoning for the change).
4. **Validate.** On commit, `schema.py` checks every approved change against the
   contract in §7 (valid enum, valid id format, field belongs to table, waiting
   fields untouched, etc.). Anything invalid is blocked and shown as an error,
   never written.
5. **Commit.** `supabase_io.py` writes only the validated, approved changes.
6. **Record.** The committed set is logged to that week's reflection file for the
   memory loop (§11).

Two independent guards: the user reviews **intent** in plain language; the code
guarantees **correctness** via schema validation. A hallucinated field or bad
status cannot reach the DB even if approved by mistake.

---

## 10. Time + scheduling constraint model

`schedule.py` produces, for a given week, a per-day map of availability tiers.
The planner assigns work to days against these tiers.

### Inputs
- **Clinical shifts:** from the ShiftAdmin iCal feed (hard blocks).
- **Fixed user rules:**
  - **Tuesday (all day):** blocked admin time.
  - **Wednesday morning:** blocked admin time.
  - **Saturday:** protected — family/personal, do not schedule work.
  - **Any other non-clinical time (Mon, Wed PM, Thu, Fri, Sun):** "prime" —
    long uninterrupted deep-work stretches are most reliable here.

### Availability tiers (per day/block)
- `clinical` — working a shift; not available for task work.
- `protected` — Saturday; never schedule.
- `admin` — Tue / Wed AM; the user CAN still schedule tasks here, but lacks
  reliable long uninterrupted stretches → assign lighter, fragmentable, or
  administrative tasks; avoid deep-focus projects.
- `prime` — non-clinical, non-admin, non-protected → best for deep work and the
  highest-priority items.

### Planner behavior (`planner.py`)
- Pull current projects/tasks + due dates + the week's availability map +
  retrieved intentions/north-stars.
- Prioritize by: hard due dates first, then alignment with stated intentions,
  then age/staleness, then user feedback patterns from memory.
- Assign each chosen item a `scheduled_date` (and optionally `scheduled_time`),
  placing deep-focus work in `prime` blocks and lighter work in `admin` blocks,
  never on `protected` or `clinical`.
- Output a proposed weekly plan as a set of `propose_set_scheduled` (and related)
  changes for review — not direct writes.

Encode the fixed rules in `config.toml` so they're easy to adjust without code
changes (e.g. if Wednesday-morning admin ever shifts).

---

## 11. Memory and "learning me" (no fine-tuning)

Adaptation = retrieval + an evolving prompt, with the model fixed.

### Stores (in `memory/`)
- **`intentions.md`** — north stars, long-term goals, current quarter focus.
  Primarily user-authored; the coach may propose edits (reviewed like any
  change).
- **`preferences.md`** — learned working preferences ("prefers writing in the
  morning", "tends to overload Thursdays", "wants ≤3 deep-work items/day").
  Updated from feedback during sessions.
- **`reflections/YYYY-MM-DD.md`** — one per weekly session: what was reviewed,
  what was planned, what was committed, and the user's feedback.

### The closed loop (why this works better than fine-tuning)
The G&F **archive** is ground truth for what actually got done. Each session the
coach compares the prior week's *plan* (last reflection file) against the
*archive* (what was completed) and surfaces the gap: "You planned the grant draft
for Monday; it's still in backlog. Reschedule, shrink, or drop?" That feedback is
written back to `preferences.md`/the reflection, and retrieved next time. Over
weeks this measurably tunes the coach to the user — cheaply, transparently, and
reversibly.

### Retrieval
For v1, the corpus is small enough to load `intentions.md` + `preferences.md` +
the last N reflections directly into context (optionally summarized). Add
embedding-based retrieval only if the reflection history grows large. Don't dump
the entire archive into context — summarize it.

---

## 12. Weekly session flow (Tuesday AM)

Orchestrated by `orchestrator.py`; surfaced in the UI as a guided sequence.

1. **Startup checks:** LM Studio reachable? Supabase reachable? Reminder to close
   G&F (§7.4).
2. **Assemble context:** current projects/tasks, last 1–2 weeks of archive,
   parsed schedule for the coming week, retrieved intentions + preferences +
   last reflection.
3. **Reflect:** model summarizes last week — completed vs. planned, wins, slips,
   and notable patterns. Presented to the user; user can react/correct.
4. **Set intentions:** brief dialogue on focus for the coming week; updates
   staged for `intentions.md`/`preferences.md`.
5. **Prioritize + schedule:** planner proposes the week's day assignments and any
   subtasks/due dates, as a reviewable proposal set (§9, §10).
6. **Review + commit:** user approves/edits/skips; validated changes written.
7. **Record:** write `reflections/<date>.md` with plan + decisions + feedback.
8. **Open floor:** transition into free coaching chat (§13) if the user wants.

A session must be resumable/abortable without writing partial state.

---

## 13. Coaching chat + frontier escalation

- A free-form chat mode shares the same context (memory, intentions, current
  state) but does not require a proposal flow — though the model can still stage
  changes mid-conversation ("want me to add that as a subtask?").
- **Escalation:** the system prompt instructs the model that when a topic exceeds
  its depth (nuanced career strategy, emotionally weighty decisions, complex
  trade-offs), it should pause and produce a **handoff prompt** — a self-contained
  block the user can paste into a frontier-model chat, including the relevant
  context summary. The UI renders this as a copyable block.
- Because a 32B model's self-judgment is imperfect, also expose a manual
  **`Escalate`** button/command that forces the model to package the handoff
  prompt on demand. Treat auto-escalation as a suggestion, not a gate.

---

## 14. Conversation-summary notes

- Tool: `propose_append_note(item_type, id, text)`.
- Notes fields are plain text; **append** a short dated line
  (`[YYYY-MM-DD] <one or two sentences>`) — never rewrite the existing note.
- The model gets an explicit bar in its prompt: only propose a note when a
  **durable decision, constraint, or change of direction** about that
  project/task was made in conversation. No play-by-play.
- Surfaces in the weekly session too: "Here are 3 notes I'd add from our
  conversations this week — approve / edit / skip."
- Runs through the same approve-before-commit gate.

---

## 15. Config and secrets

- **Secrets live only in local config** (`.env` / `config.toml`), loaded by
  `config.py`. They are **never** placed in the model context, never logged,
  never committed. `config.example.toml` and `.env.example` are the only
  templates checked in (the repo is local-only regardless).
- Required secrets/values:
  - `SUPABASE_URL` = `https://copzqbnjoakvcrvmedev.supabase.co`
  - `SUPABASE_KEY` (service or anon key with RLS — see note below)
  - `GF_USER_ID` (the user's Supabase Auth uuid; all rows are scoped by it)
  - `SHIFTADMIN_ICAL_URL` — the `schedule_ical.php?...` feed. **This URL embeds an
    auth token (`h=…`) and is effectively a credential.** Local config only.
  - `LM_STUDIO_BASE_URL` = `http://localhost:1234/v1`
  - `LM_MODEL` = the loaded model id.
- **RLS note:** all G&F tables are scoped by `user_id` with row-level security.
  Single-user local use means either (a) an anon key plus the user's auth session,
  or (b) a service key used carefully with an explicit `user_id` filter on every
  query. Prefer (a) if a stored session is workable; if using a service key,
  `supabase_io.py` must inject `GF_USER_ID` into every read and write and never
  operate cross-user.

---

## 16. UI and the "desktop app" feel

A true notarized native `.app` is out of scope for v1, but the experience can
feel like a desktop app without that overhead:

- Serve a clean single-page UI from FastAPI on localhost.
- `run.sh` starts the service and opens it in a dedicated browser window; the
  page can ship a `manifest.json` so the user can "Install" it as a standalone
  PWA window (no address bar — reads as an app), mirroring how G&F is installable.
- Optionally add a tiny menubar launcher later (e.g. via `rumps`) that boots the
  service and opens the window. Defer to v2.

Two views: **Weekly Session** (guided flow + proposal review) and **Coach Chat**.
Keep styling simple; it may borrow G&F's paper/ink palette for familiarity but is
a separate codebase with its own CSS.

---

## 17. Security / trust model

- Single user, single machine, local network only. The trust boundary is the
  user's laptop.
- The model is untrusted with respect to writes: it can only *propose*, and every
  write is human-approved and schema-validated.
- Credentials never enter the model context.
- No outbound network except: LM Studio (localhost), Supabase (the user's own
  project), and the ShiftAdmin feed.
- The repo is not hosted anywhere; still, secrets stay in gitignored local config
  so nothing sensitive ends up in a file that might later be shared.

---

## 18. Suggested build order for v1

Build in thin vertical slices so each step is runnable:

1. **Skeleton:** FastAPI app, config loading, startup checks (LM Studio +
   Supabase reachability). `run.sh`.
2. **Read path:** `supabase_io.py` + `schema.py` mappers; `get_projects/tasks/
   archive/tags`. Verify against real data, read-only.
3. **LLM loop:** `llm.py` chat with LM Studio + tool-calling; wire the read tools.
   Confirm the model can answer "what's in my backlog?" correctly.
4. **Schedule:** `schedule.py` iCal fetch/parse + the time-rule tiers; `get_
   schedule`. Verify a week renders correct clinical/admin/protected/prime blocks.
5. **Proposal + commit:** `tools.py` mutating tools (stage only), `review.py`
   plain-language rendering, validation, human-approved commit. Test with a
   single subtask add end-to-end.
6. **Planner:** `planner.py` weekly prioritization + day assignment → proposal set.
7. **Memory:** `memory.py` load/save/retrieve; reflection file writing; the
   plan-vs-archive feedback comparison.
8. **Orchestrator + UI:** the guided weekly session + coach chat views; escalation
   handoff; summary-notes.
9. **Polish:** PWA manifest / standalone window; startup reminders; error states.

Each slice should be independently testable. Prioritize correctness of the read
path and the commit guards before the planner gets clever.

---

## 19. Open questions to resolve during the build

- Supabase auth approach (stored user session vs. service key + enforced
  `user_id` filter) — pick early; it shapes `supabase_io.py`.
- iCal timezone handling for shifts that cross midnight or DST boundaries.
- Exact wording/threshold for the model's note-worthiness and escalation bars
  (tune from real use).
- Whether `intentions.md` edits should ever be auto-applied or always reviewed
  (default: always reviewed).

---

## 20. Standing rules (recap for every coding session)

- **Propose → approve → commit. No unattended writes. Plain-language review.**
- **Respect the G&F schema contract (§7).** Treat `waiting/waiting_auto` as
  read-only. Never bypass ID formats or field mappers.
- **Secrets local only; never in model context.**
- **Model weights are fixed.** Adaptation = memory + retrieval + prompt.
- **`supabase_io.py` is the only module that touches the DB.**
- **Run weekly sessions with G&F closed; reload G&F after (§7.4).**
