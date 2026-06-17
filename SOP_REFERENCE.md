Read every .md file in this directory before writing any code:
SPEC.md, PORTFOLIOS.md, ACCOUNTS.md, COMPLIANCE.md, 
STATE_MACHINE.md, GUARDRAILS.md, AUDIT.md, FILE_TREE.md, 
and SOP_REFERENCE.md (the source SOP — treat as ground truth 
when other specs are ambiguous).

STEP 1 — REVIEW
After reading everything, give me:
  (a) one-paragraph summary of what we're building
  (b) any contradictions between SOP_REFERENCE.md and the other 
      spec files — the SOP wins; flag what to change
  (c) ambiguities the specs leave open, specifically:
      - how the client tracks sessionId (cookie? localStorage? 
        UUID returned on first /api/chat call?)
      - whether disclosures are sent as one combined message or 
        separate consecutive messages
      - how the consumer signals decline of the current ladder 
        rung (free text? buttons?)
      - whether ACC-009 (balance $12k) should allow a plan with 
        installments ≤ $1,500 or escalate outright
      - whether you should implement preferred-language prompt 
        for CA/NY/NM accounts in scope for v1
  (d) the build order you propose
Do not write code yet. Wait for my answers.

STEP 2 — SCAFFOLD
Scaffold package.json, Vite client, Express server, .env.example, 
all stub files from FILE_TREE.md. Confirm both boot. Stop.

STEP 3 — DETERMINISTIC CORE (no LLM yet)
Build with unit tests, in this order:
  portfolios.js → accounts.js → auth.js → flags.js (incl. region 
  check) → limits.js (incl. $1500 cap, hierarchy tracking) → 
  disclosures.js (hard-coded scripts) → guardrails.js
Run all tests. Show me they pass. Stop.

STEP 4 — STATE MACHINE + SESSIONS
Build stateMachine.js with the FULL state list from STATE_MACHINE.md 
(GREETING through ESCALATED). Build sessions.js. Wire /api/chat 
to handle GREETING, AUTH_PENDING, AUTH_FAILED, MINI_MIRANDA, 
COLLECTOR_STATEMENT, and PRE_LEGAL_DISCLOSURE entirely without 
the LLM — these are scripted. Show me a curl walkthrough of 
ACC-001 reaching NEGOTIATION_OPEN. Stop.

STEP 5 — LLM INTEGRATION (NEGOTIATION only)
Build llm.js, prompts.js. The LLM is invoked ONLY in NEGOTIATION 
and AWAITING_AUTH_FOR_PAYMENT states. The LLM must return JSON 
with intent + extracted + response_text. Every response goes 
through guardrails.js. Show me curl for: ACC-001 negotiating 
a 40% settlement (within the 50% cap), then confirming. Stop.

STEP 6 — AUDIT + UI
Build audit.js with all event types from AUDIT.md. Build the 
React chat. Status bar shows: state, account ref (if authed), 
portfolio, balance, attempts remaining (if auth pending). Stop.

STEP 7 — END-TO-END VERIFICATION
Walk through every account in ACCOUNTS.md. For each, show me:
  - the final state reached
  - the audit log
  - any guardrail rejections
Required outcomes:
  - ACC-001/002/003: RESOLVED with arrangement within limits
  - ACC-004 (BKY), 005 (DSP), 006 (CNA), 008 (VOD): ESCALATED 
    before any negotiation, after auth
  - ACC-007: AUTH_FAILED after 3 wrong attempts, no disclosure
  - ACC-009: either escalate (if outright) or resolve with 
    installments ≤ $1,500 (depending on Step 1 decision)

STEP 8 — README + DEMO PREP
Write README.md covering: how to run, what's real vs stubbed, 
where limits/disclosures/hierarchy are code-enforced, where the 
LLM sits and what it does NOT decide, the 9 layers of guardrails, 
how to view audit logs, and known gaps you'd fix with another day.

Ground rules:
- Never put a dollar amount, percent, or limit in a prompt string. 
  Pass the account and portfolio objects; validate output.
- Never let the LLM transition state, generate verbatim disclosures, 
  or jump rungs in the hierarchy.
- Region check, special flag check, and payment cap all run before 
  the LLM is ever called.
- If you're about to fake something, stop and ask.
- After each step, summarize what changed and what's next.
