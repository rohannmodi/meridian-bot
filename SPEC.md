# Meridian Recovery Services — Collections Chatbot

## What this is
A compliant debt-collection chatbot prototype for a third-party 
collections agency. Consumer arrives on the agency website, 
authenticates, and either resolves their account or gets escalated.

## Non-negotiable rules
1. NEVER invent a dollar amount, date, discount %, or policy.
2. NEVER exceed portfolio limits (see PORTFOLIOS.md).
3. NEVER disclose account details before authentication succeeds.
4. NEVER negotiate on special-flag accounts — escalate instead.
5. Every state change, offer, and disclosure is logged to an audit trail.

## Architecture
- Frontend: React (Vite), single chat UI component
- Backend: Node + Express, single /api/chat endpoint
- LLM: Anthropic API, model `claude-sonnet-4-6`
- Store: in-memory JS object (mock accounts)
- Session: in-memory Map keyed by sessionId (cookie or generated)

## The core principle
The LLM generates language. Code makes decisions.
- LLM does: phrasing, tone, empathy, intent extraction from consumer text
- Code does: auth check, flag check, limit enforcement, math, state transitions

The LLM returns structured JSON:
{
  "intent": "REQUEST_SETTLEMENT" | "REQUEST_PLAN" | "PAY_FULL" | 
            "PROVIDE_AUTH_INFO" | "ASK_QUESTION" | "REQUEST_HUMAN" | "OTHER",
  "extracted": { ...fields relevant to intent... },
  "response_text": "what to say to the consumer"
}

Code then validates `response_text` against the account record 
and either passes it through, modifies it, or replaces it.

## Conversation state machine
States: CONSENT_PENDING → AUTH_PENDING → DISCLOSURE_PENDING → 
NEGOTIATION → RESOLVED | ESCALATED | AUTH_FAILED

Transitions are triggered by code, not by the LLM.

## Deliverables for demo
- Happy path: auth → disclosures → settlement within limit → confirmed
- Escalation path: bankruptcy account OR auth failure → human handoff
- Audit log viewable (console output or /api/audit/:sessionId)

## Out of scope
- Real payments
- Real telephony
- Persistent storage
- User accounts beyond the mock store
- Voice (bonus only)
