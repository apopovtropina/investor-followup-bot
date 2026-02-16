# Investor Follow-Up Bot

## Project Overview
A Slack bot (deployed on Railway) that integrates with Monday.com to track investor follow-ups for a fundraising pipeline. Built with Node.js, Slack Bolt SDK (Socket Mode), Monday.com GraphQL API, and Anthropic Claude for natural language understanding.

## Architecture
- **Entry point:** `src/index.js` — loads reminders, registers commands, starts Slack app, starts cron jobs, starts reminder checker
- **Slack commands:** `src/slack/commands.js` — hybrid regex + NLU message handler pipeline
- **Slack messages:** `src/slack/messages.js` — Slack message formatters (overdue list, investor status, reminder notifications, daily digest with user tagging)
- **Slack notifications:** `src/slack/notifications.js` — DM notifications for follow-up assignments with channel fallback
- **Monday.com client:** `src/monday/client.js` — GraphQL client using native `fetch`, includes `API-Version: 2024-10` header
- **Monday.com queries:** `src/monday/queries.js` — `getActiveInvestors()` reads board items with column value parsing
- **Monday.com mutations:** `src/monday/mutations.js` — `updateNextFollowUp`, `updateLastContactDate`, `updateAssignedTo`, `removeGoingColdFlag`, `testMondayWrite`, `createFollowUpActivity` (writes to Relationship Management), `logCommunication` (writes to Communications Log), `deleteItem`
- **AI intent parser:** `src/ai/intentParser.js` — Anthropic Claude NLU for conversational message parsing (extracts action, investor name, date, assignee, missing_info)
- **AI contact parser:** `src/ai/contactParser.js` — Anthropic Claude parses pasted contact info (name, phone, email, LinkedIn, notes) for multiple contacts
- **AI suggestions:** `src/ai/suggestions.js` — Claude-powered follow-up suggestions for daily digest
- **User mapping:** `src/utils/userMapping.js` — Slack ↔ Monday.com user resolution with hardcoded team IDs + in-memory caching (matches by email/name)
- **Reminders store:** `src/reminders/store.js` — persistence to `reminders.json`, `addReminder()` stores investor context
- **Reminders checker:** `src/reminders/checker.js` — 60-second `setInterval` polling loop, posts Slack notifications when reminders are due
- **Date parser:** `src/utils/dateParser.js` — chrono-node wrapper, defaults to 9am ET, handles timezone abbreviations
- **Name matching:** `src/utils/nameMatch.js` — Fuse.js fuzzy matching (threshold 0.35)
- **Centralized board config:** `src/config/monday-boards.js` — all board IDs, column IDs, group IDs, team user IDs
- **Config:** `src/config.js` — imports from `config/monday-boards.js`, exposes multi-board architecture, timezone `America/New_York`, cadence tiers
- **Cron jobs:** `src/scheduler/cron.js` — daily scan, weekly summary, stale alerts, 15-min polling

## Message Processing Pipeline
1. **Deduplication** — skip already-processed messages via `processedMessages` Map
2. **Slack text cleaning** — strip markdown formatting, decode `<tel:>`, `<mailto:>`, `<url|text>` Slack formatting
3. **Fast regex path** — well-known commands matched instantly (zero latency): "test monday", "who's overdue", "status on X", "contacted X today"
4. **NLU path** — if no regex match, message is sent to Anthropic Claude for intent parsing
5. **Missing info** — if NLU detects missing required fields, bot asks targeted follow-up question
6. **Intent routing** — parsed intent dispatched to handler: `schedule_followup`, `assign_followup`, `log_touchpoint`, `check_status`, `list_overdue`, `list_by_status`, `list_not_contacted`, `test_monday`, `add_investor`, `contact_info`, `count_investors`
7. **Confidence threshold** — intents with confidence < 0.5 trigger a conversational "I'm not sure" help response

## Key Technical Details
- **Multi-board architecture (Feb 2026 audit):**
  - **Investor List** (18399326252) — READ investor data
  - **Relationship Management** (18399401453) — WRITE follow-up activity (groups: `topics`=Active, `group_title`=Completed)
  - **Communications Log** (18399326425) — LOG communications
  - **Active Offerings** (18399326336) — deal context for AI suggestions
  - **Newsletter** (18399401340) — newsletter bot
  - **File Tracker** (18399207642) — file collection bot
- **Investor List Columns:** status=`color_mm0d1f8z`, email=`email_mm0dh83c`, phone=`phone_mm0dymr8`, assignedTo=`multiple_person_mm0dq26t`, lastContactDate=`date_mm0dm8y0`, nextFollowUp=`date_mm0drsbg`, notes=`long_text_mm0dvjg7`
- **RM Columns:** investorStatus=`color_mm0mbm8z`, cadence=`color_mm0m5rtx`, lastContact=`date_mm0m92td`, nextFollowUp=`date_mm0mme0w`, commMethod=`color_mm0m1ysc`, email=`email_mm0mjwa8`, phone=`phone_mm0m8ye5`, notes=`long_text_mm0mrnn5`, linkedInvestor=`board_relation_mm0myg9c`
- **Team User IDs:** Anton=98265513, Alejandro=67053759, Casey=98514143
- **Slack Channel:** #monday-investor-followups (`C0ADB93MTLP`)
- **Slack Socket Mode** — no webhook URLs needed
- **Deployed on Railway** — auto-deploys from GitHub pushes to `main`
- **Monday.com mutations** use GraphQL variables approach (avoids JSON double-escaping issues)
- **People column format:** `{"personsAndTeams":[{"id":PERSON_ID,"kind":"person"}]}`
- **User mapping cache:** 1-hour TTL, maps Slack users to Monday.com person IDs via email match

## Supported Slack Commands (Conversational)
The bot understands natural language in the configured channel:
- **Schedule follow-up:** "Hey can someone follow up with Wyatt Heavy this week?", "Remind me to call Scott Pastel on Monday", "We need to reach out to Skyler Martin before end of week"
- **Assign follow-up:** "Tell Alejandro to follow up with Bobby tomorrow", "@alejandro remind him to call Wyatt Heavy by Friday" — assigns person on Monday.com + sends DM
- **Log touchpoint:** "contacted [Name] today", "spoke with [Name]", "just got off a call with [Name]"
- **Check status:** "Has anyone talked to Jalin Moore recently?", "status on [Name]", "check on [Name]"
- **List by status:** "What's the status on all our hot leads?"
- **List not contacted:** "Who hasn't been contacted in the last 2 weeks?"
- **Check overdue:** "who's overdue", "overdue investors"
- **Diagnostics:** "test monday"

## Slack App Required Scopes
- `channels:history`, `channels:read`, `channels:join` — read channel messages
- `chat:write` — post messages
- `users:read`, `users:read.email` — look up user profiles for mapping
- `im:write` — DM assigned users (falls back to channel mention if missing)
- `connections:write` — Socket Mode

## Team Member Slack IDs (hardcoded in userMapping.js)
- Anton → U0A9BRJSS2U
- Alejandro → U0A9BLW5480
- Freddie → U0AF1LGMSAU
- Jim → U0A8HSQCKML
- Nate → U0A8HGP7BDG
- Deatrich → U0AE7C9LK8A
- Austin → U0A8WESSL81

## Recent Changes (Feb 2026)
1. Added Anthropic Claude NLU intent parsing (`src/ai/intentParser.js`) — replaces rigid regex for conversational messages
2. Added Slack ↔ Monday.com user mapping (`src/utils/userMapping.js`) with 1-hour cache + hardcoded team member lookup
3. Added `updateAssignedTo()` mutation for Monday.com people column
4. Added DM notification system (`src/slack/notifications.js`) with channel fallback
5. Added `assign_followup` handler — resolves assignee, updates Monday.com, sends DM
6. Added `list_by_status` and `list_not_contacted` handlers
7. Updated daily digest to tag assigned users with `<@USERID>` via Slack user map
8. Conversational response style (no more rigid ✅ emoji confirmations)
9. Kept all existing functionality: regex fast-path, touchpoint logging, cadence, cron jobs, reminders
10. **Add New Investor** (`src/ai/contactParser.js`) — parses pasted contact info via Claude, creates Monday.com items with phone/email/LinkedIn/notes, handles multiple contacts in one message, checks for duplicates
11. **Contact Info Lookup** — "what's Scott's phone?", "contact info for X" — returns phone/email from Monday.com
12. **Investor Count** — "how many investors do we have" — pipeline summary by status with overdue count
13. **Message Deduplication** — `processedMessages` Map prevents double-processing, auto-cleans every 5 minutes
14. **Slack Text Cleaning** — `cleanSlackText()` strips markdown (backticks, bold, italic), decodes `<tel:>`, `<mailto:>`, `<url|text>` Slack formatting before NLU
15. **Error Handling & Retry** — Monday.com client retries once on 429/5xx errors after 30-second delay
16. **Preposition Stripping** — `stripNamePrefix()` in `resolveInvestor()` strips "with/for/to/on" as defense-in-depth
17. **Missing Info Follow-ups** — NLU returns `missing_info` array; bot asks targeted questions like "Which investor?" instead of generic help
18. **`createInvestor()` mutation** in `mutations.js` — uses `create_item` GraphQL mutation, sets phone/email/LinkedIn/notes/nextFollowUp, defaults to Cold/New Lead group
19. **Multi-board write architecture** (Feb 15 2026) — touchpoints now write to Relationship Management board (follow-up activity) AND Communications Log board in addition to updating Investor List
20. **Centralized board config** (`src/config/monday-boards.js`) — single source of truth for all Monday.com board IDs, column IDs, group IDs, team user IDs
21. **New mutations:** `createFollowUpActivity()` writes to RM board, `logCommunication()` writes to Comms Log, `completeFollowUp()` moves to Completed group, `deleteItem()` for test cleanup
