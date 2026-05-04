# Mind2 — Personal Installation

Personal nanoclaw v2 installation running on a Raspberry Pi 5. One agent (Mind2) wired to Telegram, with Gmail and Google Calendar integrations, an Obsidian vault for long-term memory, and a set of daily/weekly recurring tasks.

---

## Hardware & Infrastructure

- **Host**: Raspberry Pi 5
- **OS**: Linux (systemd)
- **Service**: `nanoclaw-v2-a448ef53.service` — enabled, auto-starts on boot
- **Linger**: enabled — starts without login after power outage
- **Runtime**: Docker containers (Bun agent-runner inside)
- **Credential management**: OneCLI Agent Vault (proxy-level credential injection)

---

## Agent: Mind2

| Property | Value |
|---|---|
| Folder | `groups/dm-with-santi/` |
| Channel | Telegram (personal DM) |
| Model | Claude Sonnet (via Anthropic API / Claude Agent SDK) |
| Session mode | Shared (one persistent session per DM) |

### Configuration files

| File | Purpose |
|---|---|
| `groups/dm-with-santi/CLAUDE.local.md` | Agent personality, vault instructions, recurring tasks spec |
| `groups/dm-with-santi/container.json` | MCP servers (Gmail, Calendar), additional mounts |

---

## Integrations

### Telegram
- Single DM channel wired to Mind2
- Voice messages transcribed via Groq Whisper API
- Interactive cards (buttons) for confirmations (email send, questions)

### Gmail
- **Read**: `mcp__gmail__search_emails`, `mcp__gmail__get_email`, etc.
- **Send**: custom `mcp__nanoclaw__gmail_send` tool — always shows a Telegram confirmation card before sending. `mcp__gmail__send_email` is blocked at SDK level.
- Credentials injected via OneCLI (never stored in container)

### Google Calendar
- Read/write via `mcp__calendar__*` tools
- Multi-calendar support via `@cocal/google-calendar-mcp`
- Credentials injected via OneCLI

---

## Obsidian Vault

Mounted at `/workspace/extra/obsidian/` inside the container (host path: `/home/asibanez/obsidian/vault/`).

### Structure

```
vault/
├── Diary/          # Daily logs, ISO filenames (YYYY-MM-DD.md)
├── Memories/       # Curated moments, organized by person/topic
│   ├── Mom/
│   ├── Aba/
│   └── ...
├── Meetings/       # One file per meeting; [personal] tag for non-work
├── People/         # One file per person (agent-managed, full names)
│   └── FirstName LastName.md
├── TODO/
│   ├── Work.md
│   └── Personal.md
└── Me.md           # Living profile of Santi (agent-managed, append-only)
```

### People file format

Every `People/` file has YAML frontmatter for alias resolution and coreference:

```markdown
---
aliases: [FirstName, nickname, "relationship name"]
relationship: wife/friend/colleague/etc
---

# Full Name

2026-05-03: ...
```

### Wikilinks convention

- Agent adds `[[wikilinks]]` for people, organizations, and named projects when writing/updating notes
- First mention only per note; canonical name always (never a nickname)
- Alias resolution: checks `People/` frontmatter and `Me.md` before linking
- Stubs created for new entities with empty frontmatter

### Agent vault behavior

- Personal facts about Santi → `Me.md` (silently, no confirmation)
- Facts about people → `People/[FirstName LastName].md` (silently)
- Business cards → `People/` file + follow-up question for context notes
- Bilingual: non-English input stored as original + English translation

---

## Recurring Tasks

Defined in `CLAUDE.local.md` as the canonical spec; runtime rows live in the session's `inbound.db`. Agent self-heals on session start if any row is missing.

| Cron | Task |
|---|---|
| `0 23 * * *` | Daily 11pm — voice diary reminder |
| `30 23 * * *` | Daily 11:30pm — tomorrow's calendar briefing |
| `0 9 * * *` | Daily 9am — morning email digest |
| `0 9 * * 0` | Sunday 9am — weekly review (vault scan + calendar) |

**Important**: all date calculations use `mcp__calendar__get_current_time` with `America/New_York` timezone — never UTC-based JS date math (container clock is UTC).

---

## Message Flow

```
Telegram → nanoclaw host (router) → inbound.db → Docker container (Mind2)
                                                        ↓
Telegram ← nanoclaw host (delivery) ← outbound.db ← Claude Agent SDK
```

1. Telegram message arrives at the host via polling
2. Router writes to session's `inbound.db`, wakes container
3. Agent-runner polls `inbound.db`, calls Claude with full conversation history
4. Claude writes response + any tool results to `outbound.db`
5. Host delivery loop polls `outbound.db`, sends back to Telegram

**Context compaction**: when conversation history approaches ~140k tokens, the Claude Agent SDK automatically summarizes older turns. Start a new Telegram session when topics change to keep token usage low.

---

## Key Directories

```
nanoclaw/
├── src/                    # Host Node process (TypeScript)
├── container/              # Agent container (Bun + Claude Agent SDK)
│   └── agent-runner/
├── groups/
│   └── dm-with-santi/      # Mind2 config (tracked in git)
├── data/                   # Runtime data (gitignored)
│   ├── v2.db               # Central DB (users, sessions, routing)
│   └── v2-sessions/        # Per-session inbound.db + outbound.db
├── logs/                   # Host logs (gitignored)
└── .env                    # Secrets (gitignored)
```

---

## Maintenance

### After config changes
```bash
pnpm run build
systemctl --user restart nanoclaw-v2-a448ef53.service
```

### After container changes (Dockerfile, MCP servers)
```bash
./container/build.sh
docker ps -q --filter 'name=nanoclaw-v2-' | xargs -r docker kill
```

### Check service status
```bash
systemctl --user status nanoclaw-v2-a448ef53.service
tail -f logs/nanoclaw.log
```

### Migration to new machine
1. Clone the repo (includes `groups/dm-with-santi/` config)
2. Copy `data/` directory (sessions, scheduled tasks, central DB)
3. Copy `/home/asibanez/obsidian/vault/` (knowledge base)
4. Copy `~/.gmail-mcp/` and `~/.calendar-mcp/` (OAuth credentials)
5. Run setup: `bash nanoclaw.sh`
6. Agent will self-heal any missing scheduled tasks from `CLAUDE.local.md` on first session

---

## Gitignore Notes

- `groups/dm-with-santi/` — **tracked** (private repo, safe to commit)
- `groups/main_template/` — tracked as reference template from upstream
- `data/`, `logs/`, `.env` — gitignored (runtime state and secrets)
- `**/.claude-shared.md`, `**/.claude-fragments/` — gitignored (auto-generated)
