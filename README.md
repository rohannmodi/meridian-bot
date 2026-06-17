# Meridian Recovery Services — Debt Collection Chatbot

FDCPA-compliant self-service debt negotiation prototype.  
Node.js + Express backend · React + Vite frontend · Anthropic Claude LLM.

---

## Quick Start

```bash
# Prerequisites: Node ≥ 18, an Anthropic API key

cp .env.example .env          # then set ANTHROPIC_API_KEY=sk-ant-...

npm install

# Terminal 1 — API server on :3001
npm run dev:server

# Terminal 2 — Vite dev server on :5173
npm run dev:client
```

Open http://localhost:5173. Click **Dev accounts ▾** in the identity form to fill credentials automatically.

### Unit tests

```bash
npm test
```

### End-to-end verification (all 9 accounts)

```bash
node tests/e2e.js 2>&1 | tee tests/e2e-output.txt
```

---

## Architecture

```
Browser (React + Vite :5173)
        │  POST /api/chat
        │  GET  /api/audit/:sessionId
        ▼
Express server (:3001)
  ├── chat.js          — state machine dispatcher (no LLM calls here)
  ├── stateMachine.js  — 9 states, transition table, assertTransition()
  ├── sessions.js      — in-memory Map<UUID, session>
  ├── auth.js          — 5-field identity verification
  ├── flags.js         — escalation flag + region checks
  ├── limits.js        — all dollar arithmetic (cap, plans, settlements)
  ├── disclosures.js   — verbatim compliance scripts (Mini-Miranda, Reg E, …)
  ├── portfolios.js    — P-100 / P-200 / P-300 configuration
  ├── accounts.js      — 9 mock accounts
  ├── prompts.js       — LLM system-prompt builders
  ├── llm.js           — Anthropic SDK wrapper; structured JSON output
  ├── guardrails.js    — layers 3–9 post-LLM validation
  └── audit.js         — compliance event log + GET /api/audit handler
```

### State machine

```
GREETING → AUTH_PENDING → MINI_MIRANDA_PENDING* → NEGOTIATION_OPEN
                       ↘ AUTH_FAILED → ESCALATED
                       ↘ ESCALATED

NEGOTIATION_OPEN → NEGOTIATION ⟲ → AWAITING_CONFIRMATION → RESOLVED
               ↘ ESCALATED                              ↘ NEGOTIATION (CONFIRM_NO)
```

`MINI_MIRANDA_PENDING` is transient — it is entered and exited within the same request cycle; the consumer never waits there.

Every state change calls `assertTransition(from, to)` which throws on illegal moves. The LLM **never** transitions state.

---

## What Is Real vs Stubbed

| Component | Status | Notes |
|---|---|---|
| State machine | **Real** | 9 states, strict transition table |
| Authentication | **Real** | 5-field match (case-insensitive names, trimmed) |
| Flag / region checks | **Real** | BKY, DSP, VOD, CNA, CDP, FRA, DEC, MIL, LIT → ESCALATED |
| Disclosure scripts | **Real** (verbatim) | Mini-Miranda, Collector Statement, Pre-Legal, Reg E |
| Offer hierarchy | **Real** | PIF → BIF_PAYMENTS → SIF → SIF_PAYMENTS → PPA |
| Dollar arithmetic | **Real** | All from `limits.js`; never LLM-generated |
| $1,500 payment cap | **Real** | Enforced in code at offer-build time AND at confirmation |
| Audit log | **Real** | Per-session event array; GET /api/audit/:sessionId |
| LLM intent extraction | **Real** | claude-sonnet-4-6; structured JSON output |
| Session persistence | **Stubbed** | In-memory `Map` — lost on server restart |
| Payment processing | **Stubbed** | Arrangement "confirmed" message only; no ACH integration |
| Reg E dates | **Stubbed** | Placeholder `[DATE]` — no payment scheduling yet |
| Preferred-language output | **Stubbed** | Audit event logged; bot output unchanged (known gap) |
| Financial profile | **Stubbed** | `hasFinancialProfile = false` always; max 6 months |

---

## Limit Enforcement

All calculations live in `limits.js`. Dollar amounts are **never** hardcoded in prompt strings — the LLM receives account/portfolio objects and guardrails validate its output.

### Self-service payment cap — $1,500

A single payment (installment, monthly payment, or lump sum) exceeding $1,500 triggers **funds verification escalation**. The check runs in two places:

1. **At offer-build time (post-auth):** If even the best possible plan (balance ÷ max months) and best SIF installment (settlement ÷ 3) both exceed $1,500, the bot escalates immediately after delivering disclosures — no offers are made.

2. **At consumer acceptance:** Before generating the Reg E confirmation script, the offer's per-payment amount is checked. If it exceeds $1,500, `fundsVerificationScript()` is sent and state → ESCALATED.

Example — ACC-009 ($12,000, P-100, 6-month max):

| Rung | Per-payment | Self-serviceable? |
|---|---|---|
| PIF | $12,000 | No |
| BIF_PAYMENTS (6 mo) | $2,000 | No |
| SIF (35% off) | $7,800 | No |
| SIF_PAYMENTS ($7,800 ÷ 3) | $2,600 | No |
| PPA (6 mo) | $2,000 | No |

→ Immediate escalation after disclosures. No PIF question is asked.

### Portfolio limits

| Portfolio | Client | Type | Max discount | Max months |
|---|---|---|---|---|
| P-100 | Northwind Capital | Auto / secured | 35% | 6 |
| P-200 | Apex Card | Credit card | 50% | 12 |
| P-300 | Harbor Recovery | Personal pre-legal | 25% | 18 (effective 6 without profile) |

BIF_PAYMENTS selects the shortest month-count whose monthly payment stays ≤ $1,500.  
SIF_PAYMENTS uses exactly 3 installments (MAX_SIF_INSTALLMENTS).

---

## LLM Role

The LLM (claude-sonnet-4-6) is called **only** in three states:

| State | Task |
|---|---|
| NEGOTIATION_OPEN | Extract consumer intent toward PIF ask |
| NEGOTIATION | Extract intent toward current rung offer, OR present the next rung (presentOffer=true) |
| AWAITING_CONFIRMATION | Extract CONFIRM_YES / CONFIRM_NO from consumer's YES/NO reply |

### What the LLM does

- Returns structured JSON: `{ intent, extracted, response_text }`
- Reads dollar amounts from offer objects passed in the system prompt
- Interprets natural-language consumer intent ("can't do that" → DECLINE, "sounds good" → ACCEPT)

### What the LLM never does

- Generate verbatim compliance text (Mini-Miranda, Reg E, pre-legal scripts)
- Transition state
- Invent dollar amounts or percentages
- Skip or reorder the resolution hierarchy
- Decide which rung to present next
- Generate payment authorization language

---

## 9 Guardrail Layers

| Layer | Location | What it checks |
|---|---|---|
| **L1** System prompt constraints | `prompts.js` | Instructs LLM: no invented amounts, no Reg E text, no state transitions |
| **L2** Structured output | `llm.js` | Parses JSON; validates `intent` (string) and `response_text` (string); strips markdown fences |
| **L3** Dollar amount validation | `guardrails.js → validateDollarAmounts()` | Every `$X` in response_text must be an account balance, valid settlement, valid monthly payment, or valid SIF installment. Tolerance: ±$0.02 for rounding. |
| **L4** Intent gating | `guardrails.js → gateIntent()` | Intent must be in the allowed set for the current state (e.g., CONFIRM_YES only valid in AWAITING_CONFIRMATION). Out-of-band intents return a deterministic deflect message. |
| **L5** Percentage validation | `guardrails.js → validatePercentages()` | No percentage in response_text may exceed portfolio.maxDiscount |
| **L6** Verbatim disclosure detection | `guardrails.js → detectVerbatimDisclosures()` | Detects if LLM reproduced Mini-Miranda or pre-legal text. Logged as audit warning; consumer sees the code-inserted version. |
| **L7** Payment cap (text scan) | `guardrails.js → checkPaymentCap()` | Available for standalone use; not applied to response_text to avoid false positives on total amounts mentioned in context |
| **L8** State-transition enforcement | `stateMachine.js → assertTransition()` | Every state update calls this; throws on illegal moves |
| **L9** Hierarchy enforcement | `chat.js → getNextRung()` | Rungs are always offered PIF → BIF_PAYMENTS → SIF → SIF_PAYMENTS → PPA in order; the LLM cannot skip or reverse rungs |

**Fallback behavior:** If L3 or L5 fails, `response_text` is replaced with `"Let me recalculate that for you."` and the session stays in its current state. The violation is logged to the audit trail.

---

## Audit Log

Every session maintains an append-only event array at `session.audit`.

**Endpoint:** `GET /api/audit/:sessionId`

```json
{
  "sessionId": "...",
  "state": "RESOLVED",
  "count": 18,
  "audit": [ ... ]
}
```

### Event schema

```json
{
  "ts":           "ISO-8601 timestamp",
  "sessionId":    "UUID",
  "event":        "EVENT_TYPE",
  "source":       "code | llm",
  "data":         { ... },
  "state_before": "STATE_NAME",
  "state_after":  "STATE_NAME"
}
```

### Event types

| Event | Fired when |
|---|---|
| `STATE_CHANGE` | Every state transition |
| `AUTH_ATTEMPT` | Each auth submission (success or failure) |
| `DISCLOSURE_DELIVERED` | Each verbatim script sent to consumer (one event per script) |
| `OFFER_MADE` | Code builds and presents a rung offer |
| `HIERARCHY_STEP` | Offer presented; updated with `accepted: true/false` on consumer response |
| `CONSUMER_MESSAGE` | Consumer sends a message (non-auth states) |
| `BOT_MESSAGE` | Bot sends a response |
| `ESCALATION` | Session moves to ESCALATED, with reason code |
| `PAYMENT_AUTHORIZATION` | Consumer confirms YES at AWAITING_CONFIRMATION |
| `FUNDS_VERIFICATION_REQUIRED` | Payment amount exceeds $1,500 self-service cap |
| `PREFERRED_LANGUAGE_REQUIRED` | Account state is CA, NY, or NM (known gap — no output change) |
| `OFFER_REJECTED_BY_GUARDRAIL` | LLM response failed L3/L5/L6 validation |

### Privacy rules

- Raw SSN and ZIP are **never** logged. `AUTH_ATTEMPT` events record only which field names were provided.
- Raw account data is stored in the in-memory session (for the active conversation) but not written to any log file.

---

## FDCPA / Compliance Notes

| Requirement | Implementation |
|---|---|
| Mini-Miranda disclosure | Delivered verbatim from `disclosures.js` on every authenticated session before any negotiation |
| Collector identification | `collectorStatementScript(account)` — code-generated, LLM-free |
| Pre-legal disclosure (P-300) | Appended to the combined disclosure block when `needsPreLegalDisclosure()` returns true |
| Byte-identical auth failure responses | `authRetryScript()` and `authFailedScript()` return the same text regardless of whether the account reference exists |
| No account info in flag escalations | `checkFlags()` and `checkRegion()` run **before** `buildDisclosureBlock()`. Escalation response is `escalationScript()` only. |
| Payment authorization (Reg E / NACHA) | Generated entirely by `disclosures.js` (`settlementConfirmationScript`, `planConfirmationScript`). The LLM never produces this text. |
| $1,500 self-service cap | Enforced in code at offer construction and at consumer confirmation. LLM output is not trusted for this check. |

---

## Voice input/output (Chrome/Edge only)

A mic button appears in the chat input bar. Click to toggle.

- **Gray mic** — voice off (default)
- **Red pulsing mic** — listening; auto-submits after 1.5 s of silence
- **Blue pulsing mic** — bot is speaking

The bot reads its reply aloud when voice is on. Preferred voices (in order): Google US English, Samantha, Alex — falls back to first available. Rate 1.0, pitch 1.0.

Voice mode resets on page reload (React state only). If `SpeechRecognition` is unsupported, the button is hidden and a small notice appears. Safari lacks full support — use Chrome or Edge.

---

## Admin console — `http://localhost:5173/admin`

### Password

```
meridian-admin-2026
```

**Known gap:** hardcoded prototype credential, no session management, no rate limiting. Do not expose on a public network.

### Notification permissions

Grant browser notification permission on first login. Incoming handoffs fire browser notifications with `requireInteraction: true` (stay until dismissed). Clicking opens that session in the right panel.

An audio beep (Web Audio API, 880 Hz sine, ~0.45 s, no external files) fires on each new handoff request.

### Left panel — active handoffs

Lists HANDOFF_PENDING and IN_HANDOFF sessions. Each entry: consumer name (masked if auth failed), account ref, escalation reason, state badge, time waiting. Click to open in right panel. NEW badge on unaccepted sessions.

### Right panel — selected session

- Auth-failed warning if applicable ("Do not discuss account specifics")
- Disclosures warning if Mini-Miranda/collector statement weren't delivered before escalation
- Collapsible context panel — balance, creditor, portfolio, disclosures, offers, audit count
- Full conversation transcript — Consumer / Bot / Admin labeled
- Admin input (only while IN_HANDOFF) — portfolio compliance enforced on send

### Accept / end

- **Accept Handoff** — visible while HANDOFF_PENDING; moves session to IN_HANDOFF
- **End Session** — visible while IN_HANDOFF; confirms, then marks RESOLVED

If no admin accepts within 60 s, session reverts to ESCALATED and consumer receives a timeout message.

### Compliance guardrails

Server rejects any admin message containing a dollar amount below the portfolio settlement floor (`balance × (1 − maxDiscount)`). Admin sees inline error; message is not forwarded. This enforces portfolio hard ceilings without embedding dollar amounts in LLM prompts.

### Old account-management panel

Static HTML admin panel (accounts, portfolios, bank balances) now at `/admin-ops`:

```
http://localhost:5173/admin-ops
```

---

## WebSocket protocol

`ws.WebSocketServer` runs in `noServer` mode on the same HTTP server as Express, attached on the `/ws` upgrade event (port 3001).

**Consumer** connects as: `ws://host/ws?role=consumer&sessionId=<id>` — receive-only; sends continue via HTTP POST even during IN_HANDOFF.

**Admin** connects as: `ws://host/ws?role=admin&adminId=<id>`

### Server → admin messages

| Type | Description |
|---|---|
| `ACTIVE_HANDOFFS` | Sent on admin connect; full list of current handoffs |
| `HANDOFF_REQUESTED` | New session escalated |
| `SESSION_STATE_UPDATE` | State change on any session |
| `HANDOFF_ACCEPTED` | Admin accepted; state now IN_HANDOFF |
| `CONSUMER_MESSAGE` | Consumer sent a message during handoff |
| `ADMIN_MESSAGE_SENT` | Echo of admin's message after compliance pass |
| `COMPLIANCE_VIOLATION` | Admin message rejected; reason included |
| `CONSUMER_DISCONNECTED` | Consumer WS dropped |
| `HANDOFF_ENDED` | Session resolved |
| `HANDOFF_TIMEOUT` | 60 s elapsed with no admin acceptance |

### Admin → server messages

| Type | Required payload | Description |
|---|---|---|
| `ACCEPT_HANDOFF` | `sessionId` | Accept a pending handoff |
| `SEND_MESSAGE` | `sessionId`, `content` | Send message to consumer |
| `END_SESSION` | `sessionId`, `resolution` | Mark session RESOLVED |

---

## Known Gaps

1. **Preferred-language output** — Accounts in CA, NY, NM log `PREFERRED_LANGUAGE_REQUIRED` but the bot continues in English. A multilingual response path is not implemented.

2. **Payment scheduling** — Reg E confirmation scripts use `[DATE]` placeholder. No actual date calculation or ACH scheduling is connected.

3. **Financial profile** — `hasFinancialProfile` is always `false`. Consumers cannot provide income/expense data to unlock longer plan terms (e.g., P-300's 18-month maximum).

4. **Session persistence** — Sessions live in an in-memory `Map`. A server restart clears all active sessions.

5. **Concurrent session handling** — No locking on session mutations. Under concurrent requests to the same session ID, race conditions could corrupt state. Production would require atomic updates (Redis, DynamoDB, etc.).

6. **Single admin only** — HandoffManager tracks multiple admin sockets but the UX is built for one operator. No queue priority, no transfer between admins.

7. **No callback scheduling** — When handoff times out, the consumer is told a callback is being arranged, but no ticket or calendar event is created.

8. **Voice: Chrome/Edge only** — `SpeechRecognition` is unavailable in Firefox and Safari.

9. **WS state is in-process memory** — HandoffManager uses Maps; a server restart drops all active handoffs with no recovery path.

10. **SIF_PAYMENTS cap for high-balance accounts** — For accounts where the 3-installment SIF amount exceeds $1,500 per installment (e.g., ACC-002 at $1,841/installment), this rung is offered but triggers immediate funds-verification escalation on acceptance. The offer could be skipped to reduce consumer friction; this is a UX rather than compliance gap.

---

## Project Structure

```
meridian-bot/
├── src/
│   ├── server/
│   │   ├── index.js          Express entry point (http.createServer, WS init, /admin-ops)
│   │   ├── chat.js           POST /api/chat handler + IN_HANDOFF relay
│   │   ├── handoff.js        HandoffManager — WS server, handoff state, compliance checks
│   │   ├── stateMachine.js   12 states, transition table, assertTransition
│   │   ├── sessions.js       SQLite-backed session store
│   │   ├── auth.js           5-field authentication
│   │   ├── flags.js          Escalation flag + region + preferred-language checks
│   │   ├── limits.js         All dollar arithmetic
│   │   ├── disclosures.js    Verbatim compliance scripts
│   │   ├── portfolios.js     P-100, P-200, P-300 config
│   │   ├── accounts.js       SQLite-backed accounts module
│   │   ├── bank.js           Bank balance / funds verification
│   │   ├── prompts.js        LLM system prompt builders
│   │   ├── llm.js            Anthropic SDK wrapper
│   │   ├── guardrails.js     Post-LLM validation layers 3–9
│   │   └── audit.js          Audit event log + handoff audit helpers
│   ├── client/
│   │   ├── main.jsx          React entry point (routes /admin → Admin, else App)
│   │   ├── App.jsx           Consumer chat UI (voice + WS consumer)
│   │   ├── Admin.jsx         Admin live-handoff console
│   │   └── styles.css
│   └── admin/
│       └── index.html        Static account-management panel (served at /admin-ops)
├── tests/
│   ├── auth.test.js
│   ├── flags.test.js
│   ├── limits.test.js
│   ├── guardrails.test.js
│   └── e2e.js               End-to-end verification (all 9 accounts)
├── .env.example
├── package.json
└── vite.config.js
```
