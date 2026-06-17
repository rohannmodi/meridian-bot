# Audit Log Schema

Every session has an audit array. Each entry:

{
  ts: ISO timestamp,
  sessionId: string,
  event: "STATE_CHANGE" | "AUTH_ATTEMPT" | "DISCLOSURE" | 
         "OFFER_MADE" | "OFFER_REJECTED_BY_GUARDRAIL" | 
         "CONSUMER_MESSAGE" | "BOT_MESSAGE" | "ESCALATION",
  source: "code" | "llm",
  data: { ...event-specific... },
  state_before: string,
  state_after: string
}

Additional event types:
- "REGION_BLOCKED" — account in non-serviced region
- "DISCLOSURE_DELIVERED" — { which: "MINI_MIRANDA" | "COLLECTOR_STATEMENT" | "PRE_LEGAL", verbatim_match: bool }
- "HIERARCHY_STEP" — { offered: "PIF" | "BIF_payments" | "SIF" | "SIF_payments" | "PPA", accepted: bool | null }
- "PAYMENT_AUTHORIZATION" — { type, amount, dates, authorized: bool }
- "FUNDS_VERIFICATION_REQUIRED" — { amount, threshold: 1500 }
- "PRE_LEGAL_SUPPRESSED" — { reason: "BREACHED" | "NSF" }


Exposed at GET /api/audit/:sessionId for demo.

Examples:
- AUTH_ATTEMPT: { attempt: 2, success: false, fields_provided: [...] }
  (never log raw SSN/ZIP — log only which fields were attempted)
- OFFER_MADE: { type: "SETTLEMENT", amount: 2100, discount: 0.50, 
                portfolio_max: 0.50, within_limit: true }
- ESCALATION: { reason: "BKY" | "AUTH_FAILED" | "CONSUMER_REQUEST" }
