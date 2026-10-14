<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# Hey Judy — instructions for coding agents

Hey Judy is a safety companion for adults with learning disabilities, autistic adults and older
adults, against "mate crime": online friendships that turn exploitative slowly (flattery → small
loan → "don't tell your support worker" → bigger ask). The person shares a screenshot, pasted
text or a description about one friend (one chat thread per friend). Judy remembers the
friendship and answers green / amber / red / grey with plain reasons and one or two gentle
suggestions. Judy never decides for the person and never tells them to block anyone. An optional
trusted person (carer) can be alerted, but only ever sees a colour and a label like "Chat 1".

## Stack
- TanStack Start (React 19) + Tailwind 4 + shadcn/ui components in `src/components/ui`.
- Supabase: browser client `@/integrations/supabase/client`; server functions in `src/lib/*.functions.ts`
  use `requireSupabaseAuth`, so every query runs as the signed-in user under row-level security.
- Bun: `bun run dev --host 127.0.0.1 --port 3000`, `bun run test`, `bun run typecheck`, `bun run build`.
- Secrets live only in `.env.local` / hosting secrets. `ANTHROPIC_API_KEY` is server-only.

## Hard rules
1. Never put an API key or anything secret in browser code or in a `VITE_` variable.
2. Never store screenshots anywhere (not Storage, not tables, not localStorage). Send them to `judyTurnFn` only.
3. The browser never writes to `checks` (except `user_response`), `threads.tally/memory/pending/last_colour`,
   `supporter_alerts`, `pipeline_*` or `agent_log`. `judyTurnFn` and the SQL functions do that.
4. Do not change `src/lib/pipeline/**`, `src/lib/judy.functions.ts` or `src/lib/memory-tools.ts` unless the task
   is explicitly about the pipeline, and then run `bun run test` and `bun run typecheck` before finishing.
5. Never show the word "safe". Never show a colour without its status title and icon.
6. The carer view must never show messages, nicknames, rules or anything except colour, "Chat N",
   time, and the person's first name.

## The one call for a chat with Judy: `judyTurnFn` (`src/lib/judy.functions.ts`)
```ts
await judyTurnFn({ data: {
  threadId: string,          // the friend's thread
  runId: string,             // crypto.randomUUID(), made BEFORE calling (see live progress)
  action: "start" | "answer" | "share",
  text?: string,             // answer text, or pasted message / description (≤ 4000 chars)
  image?: { media_type: "image/jpeg" | "image/png" | "image/webp" | "image/gif", data: string } // base64, no "data:" prefix
}}) // → TurnResult
```
- `start`: call right after creating a new friend thread. Judy greets and asks intake question 1.
- `answer`: the person's reply to Judy's latest question (an option label or typed text).
- `share`: something to check. Shrink screenshots in the browser to ≤1600px JPEG first
  (see `shrinkScreenshot` in `src/components/pipeline/PipelineTest.tsx`).
- A check takes ~20–40 s. Show the Checking screen meanwhile.

`TurnResult` (types in `src/lib/pipeline/judy-turn.ts`):
```ts
{ status: "question" | "result" | "text" | "error", colour: "green"|"amber"|"red"|"grey"|null, message: JudyMessage }
```
Every Judy message is also saved to `public.messages` (role `judy`), so the chat can always be
rebuilt from the table. Render by `kind`:
| kind | body | show |
|---|---|---|
| `text` | `{ text }` | Judy bubble |
| `question` | `{ source: "intake"|"clarify", id, text, options[], free_text, card: ReplyCard|null }` | Judy bubble + tap options (+ text box). If `card` (grey), show the grey status card above it (screen 3A) |
| `result` | `ReplyCard` | status card (screens 3B / 4A / 4B, or grey "can't read") |
| `error` | `{ text }` | Judy bubble with the error text, and a "Try again" button |

User messages in `public.messages`: `shared` `{ text: string|null, screenshot: boolean }` (text has names
replaced, e.g. `[name]`) and `answer` `{ text }`.

`ReplyCard`:
```ts
{ colour, title, summary,                 // fixed PRD wording per colour
  explanation,                            // Judy's 1–2 sentence reason
  signs: { sign, label }[],               // ≤3. sign = a warning-sign id, "rule" or "pattern"
  what_you_can_do,                        // 1–2 gentle sentences (lightbulb box)
  actions: { primary: {id,label}, secondary: {id,label} },
  crisis: boolean,                        // → crisis screen (Samaritans 116 123)
  trusted_person_told: boolean,           // crisis alert already sent
  check_id: string | null }
```
Sign icons: `money_request` £, `secrecy` lock, `pressure_urgency` clock, `flattery` heart,
`isolation` people-crossed, `bank_or_code_request` card, `unexpected_link` link,
`threat`/`self_harm_urging` alert, `rule` shield ("Goes against: …"), `pattern` history ("Asked to borrow £20 (Wed 8 Oct)"),
anything else: dot. Use lucide-react icons with dark glyphs on coloured circles.

Action ids → what the button does:
| id | do |
|---|---|
| `done` | save `checks.user_response = "done"`, back to chat |
| `what_checked` | sheet: "Judy read the messages, checked your rules and what happened before with this person." |
| `check_carefully` ("Check safely") | tips sheet (verify by a known number, don't rush, never share codes) |
| `ask_someone` / `ask_trusted_person` | consent sheet 5A → on "Share alert": `supabase.rpc("share_alert", { p_thread_id, p_kind: colour })` |
| `who_could_i_ask` | suggestions: a family member, support worker, GP, Citizens Advice |
| `check_first` | save `checks.user_response = "check_first"`, back to chat |
| `try_again` / `describe` | reopen the share sheet |
Always save the chosen action id to `checks.user_response` when `check_id` is set.

## Live progress ("Checking…" and the judges' "Behind the scenes" panel)
Before calling `judyTurnFn`, subscribe with the same `runId`:
```ts
supabase.channel("run-" + runId).on("postgres_changes",
  { event: "INSERT", schema: "public", table: "agent_log", filter: `run_id=eq.${runId}` },
  ({ new: row }) => row.audience === "user" ? setProgress(row.note) : addJudgeLine(row)).subscribe();
```
`audience: "user"` lines are friendly ("Reading the messages…"). `audience: "judge"` lines have
`agent`, `note` and `detail` (facts, risk, rules, checker feedback, colour rule). The judges' panel is a
collapsible drawer, hidden by default.

## Other data the screens use directly (all protected by row-level security)
- `profiles` (one per user, auto-created): `first_name`, `larger_text`, `read_aloud`, `simpler_language`,
  `fewer_visuals`, `extra_guidance`, `confirmed_adult_at`, `accepted_terms_at`, `onboarding_done`, `role` ('person'|'carer').
- `rule_templates` (10 ready-made rules, `default_on` = suggested) → `rules`: upsert
  `{ user_id, code, text, active }` with `onConflict: "user_id,code"`. The one free-text rule uses `code: "custom"`.
- `threads`: new friend = insert `{ user_id, nickname }` then `judyTurnFn` `start`. List with
  `nickname, last_colour, last_used_at`, `kind = 'person'`. Home "recent checks" can read `checks` (colour, created_at) joined by thread.
- `messages`: chat history, ordered by `created_at`.
- `supporters`: invite = insert `{ user_id, first_name, relationship, crisis_alerts }`, then show `invite_code` (6 letters).
- Carer side (second phone): `rpc("accept_invite", { p_code })` → returns the person's first name;
  `rpc("carer_overview")` → `{ alert_id, person_name, kind, chat_label, acknowledged, reminders_sent, created_at, last_sent_at }[]`;
  `rpc("ack_alert", { p_alert_id })` for "I've checked in". Realtime on `supporter_alerts` works for the carer.

## Design (from the PRD, Phase 01)
Calm, chat-based, soft lilac. Judy is a glowing orb whose colour and face change with the result
(neutral lilac, grey thinking, green reassured, amber cautious, red serious). Gentle motion only, off when
`prefers-reduced-motion` is set. The orb never replaces the status word and icon.
| token | value |
|---|---|
| canvas | `#F3F3F5` |
| primary | `#8E53A1` (buttons, active tab, links; white text OK) |
| green | `#A5D75B` |
| amber | `#FBA64C` |
| red | `#DA5532` |
| grey | `#8E8E99` |
| glyph on status circles | `#1D2433` (never white on green/amber) |
| user bubble | soft lilac; Judy bubble white |
Components: Judy bubble, user bubble with time, primary button (filled purple, arrow), secondary button
(purple outline), status card (icon circle + title + one-line summary), choice list, bottom sheet, signs list,
"What you can do" box (lightbulb), contact switcher "Ask Judy about [name ▾]", tab bar (My Chats, My Rules, Settings).

### Status copy (fixed, comes in the card)
grey "Not enough information / I need a bit more detail." · green "No clear warning signs / Looks OK, but not a guarantee."
· amber "Be careful / Some signs to watch." · red "High risk — stop and get help / This may be a scam."

### Screens
01 My Chats (home): neutral orb, "Not sure about a message? Ask Judy.", "Check someone new" (primary),
"Talk to Judy" (secondary), recent checks (nickname, status icon + word, time), tab bar.
02 Chat with Judy: header "Ask Judy about [contact ▾]", greeting, message box with +, quick actions
(Add screenshot, Paste message, Describe what happened).
03 Share bottom sheet: Add screenshot / Paste a message / Describe what happened, "How do I take a screenshot?".
04 Checking: animated grey orb, progress dots, the latest `audience:"user"` line, "This usually takes a few seconds."
3A Grey + question · 3B Amber · 4A Green (with "This check cannot guarantee someone is trustworthy.") · 4B Red.
5A Share-alert consent sheet: "Share this safety alert with your trusted person? They will see that there may be a risk.
They will not see the exact message or contact name. You can still choose what to share." Buttons "Share alert" / "Not now".
5B Carer view: tabs Alerts / Overview, cards "Chat 1"… with status, time, "Someone you support might need help.", "I've checked in".
Also (simple versions): welcome + AI disclosure ("I'm an AI helper, not a person."), sign-up/login, accessibility options,
rule picker (My Rules), invite a trusted person, crisis screen (Samaritans 116 123), settings.

### States
Checking (up to ~40 s) · unreadable screenshot (grey card from the server) · network/API error: Judy bubble
"Something went wrong. Your screenshot was not saved. Try again." · crisis: red full screen with Samaritans 116 123,
and "Your trusted person has been told" only if `trusted_person_told` · no trusted person: red primary becomes "Who could I ask?".

## Accessibility checklist (every screen)
- Text ≥ 18px, body 20px, line height 1.5. Tap targets ≥ 44×44px.
- Contrast: text ≥ 4.5:1, icons ≥ 3:1. Dark glyphs on green/amber circles.
- Colour never alone: status title + icon with every colour and orb state.
- Read-aloud button on Judy's answers (`speechSynthesis`), honours `profiles.read_aloud`.
- Plain language, no idioms, never "safe". Screen-reader labels on all buttons, icons and the orb ("Judy, cautious").
- Respect `prefers-reduced-motion` and `profiles.larger_text`.

## Where things are
- `src/routes/index.tsx` currently shows a login plus developer test panels (`JudyTurnTest`, `PipelineTest`).
  Move those panels to a `/dev` route when building the real screens; keep them working.
- Pipeline (do not edit casually): `src/lib/pipeline/` — `judy-turn.ts` (turn logic, colour rule, cards),
  `judy.ts` (signs, redaction), `claude-agents.ts`, `runner.ts`, `manuals/*.md` (agent instructions).
