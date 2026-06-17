# Anti-Hallucination Guardrails

## Layer 1 — System prompt constraints
- "You may only reference dollar amounts present in the account 
  object provided. If you need a value that isn't there, ask the 
  backend by returning intent NEEDS_CALCULATION."
- "You may not invent dates. Use placeholders [DATE] and the 
  backend will fill them."
- "You may not promise anything beyond the current state's 
  allowed actions."

## Layer 2 — Structured output
LLM must return JSON. Free-form text outside response_text is rejected.

## Layer 3 — Response validator (the real guardrail)
Before sending response_text to the consumer:

1. Extract all dollar amounts from response_text via regex /\$[\d,]+(\.\d+)?/g
2. Each must equal one of:
   - account.balance
   - a valid settlement amount (balance × (1 - d), d ≤ maxDiscount)
   - a valid monthly payment (balance / n, n ≤ maxMonths)
3. Extract all percentages. Each must be ≤ portfolio max discount.
4. If any value fails, REPLACE response_text with:
   "Let me recalculate that for you." 
   and re-prompt the LLM with corrected context.

## Layer 4 — Intent gating
Only allowed intents per state are processed. Others trigger a 
"let me get back to that" deflection and re-prompt.

## Layer 5 — Audit log
Every offer, disclosure, and state change logged with:
- timestamp
- source: "code" | "llm"
- validated: true | false
- raw_llm_output (for review)

## Layer 6 — Verbatim disclosure validation

Mini-Miranda and pre-legal disclosure text is hard-coded in 
disclosures.js and inserted by code. The LLM does NOT generate 
these strings. If the LLM ever produces text matching these 
disclosures, it's logged but the code-inserted version is what 
the consumer sees.

## Layer 7 — Payment cap

Any single payment amount in an offer must be ≤ $1,500. 
If a settlement or plan installment exceeds $1,500, the guardrail 
forces escalation. (For accounts where balance > $1,500, the bot 
can still offer a plan with installments ≤ $1,500.)

## Layer 8 — Region check

Before any account discussion (even after auth succeeds), check 
account.state against the non-serviced regions list. If matched: 
ESCALATE with reason REGION_NOT_SERVICED. Do not deliver 
Mini-Miranda or collector statement — just escalate.

## Layer 9 — Resolution hierarchy enforcement

The bot must offer the top of the ladder first. The state machine 
tracks which rungs have been offered. The LLM cannot jump to 
SIF without code recording that BIF was offered and declined.

Track on the session:
  offered: { PIF: bool, BIF_payments: bool, SIF: bool, SIF_payments: bool, PPA: bool }

When LLM returns intent REQUEST_SETTLEMENT but session.offered.PIF is false,
code overrides: "Before discussing a settlement, are you able to pay 
the balance of $[BALANCE] in full today?"
