# Conversation State Machine

## States (in order)

- **GREETING** — initial state, deliver inbound greeting (which 
  contains the recording-consent notice)
- **AUTH_PENDING** — collecting auth fields (up to 3 attempts)
- **AUTH_FAILED** — terminal failure, disclose nothing, hand off
- **MINI_MIRANDA** — auth passed, deliver Mini-Miranda verbatim
- **COLLECTOR_STATEMENT** — deliver agency / client / creditor / 
  balance / receive date statement
- **PRE_LEGAL_DISCLOSURE** — only for P-300 portfolio (skipped otherwise)
- **NEGOTIATION_OPEN** — request balance in full (top of ladder)
- **NEGOTIATION** — work down hierarchy: BIF → BIF-payments → SIF 
  → SIF-payments → PPA
- **AWAITING_AUTH_FOR_PAYMENT** — offer made, awaiting Reg E / 
  NACHA authorization
- **RESOLVED** — consumer authorized, log the arrangement, escalate 
  to payment specialist for bank details (out of bot scope)
- **ESCALATED** — special flag, consumer request, auth fail, 
  non-serviced region, or payment > $1,500

## Disclosure delivery tracking

Each disclosure has a delivered_at timestamp logged. Order is enforced 
by the state machine — code will not advance to NEGOTIATION_OPEN 
until MINI_MIRANDA, COLLECTOR_STATEMENT, and (if applicable) 
PRE_LEGAL_DISCLOSURE are all marked delivered.

## Pre-legal suppression rules

PRE_LEGAL_DISCLOSURE is SKIPPED (jump straight to NEGOTIATION_OPEN) if:
- account.flags includes BREACHED_ARRANGEMENT, OR
- account.flags includes NSF_RECENT

(Not present in mock data for this prototype, but the suppression 
logic must exist.)
## Transitions
CONSENT_PENDING + "consent ok" → AUTH_PENDING
AUTH_PENDING + valid creds → check flags
  if any escalation flag → ESCALATED
  else → DISCLOSURE_PENDING
AUTH_PENDING + invalid creds (attempt < 3) → AUTH_PENDING (retry)
AUTH_PENDING + invalid creds (attempt = 3) → AUTH_FAILED → ESCALATED
DISCLOSURE_PENDING + disclosures delivered → NEGOTIATION
NEGOTIATION + offer made → AWAITING_CONFIRMATION
NEGOTIATION + "talk to human" → ESCALATED
AWAITING_CONFIRMATION + "yes" → RESOLVED
AWAITING_CONFIRMATION + "no" → NEGOTIATION
Any state + "human"/"agent"/"representative" → ESCALATED

## Per-state LLM contract
Each turn, the backend sends the LLM:
- current state
- account (only if authenticated; else null)
- conversation history (recent N turns)
- consumer's latest message
- allowed intents for this state

LLM returns JSON. Backend validates, applies guardrails, transitions state.
