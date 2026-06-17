# Portfolio Limits — HARD CEILINGS

These are enforced in code (`src/server/limits.js`), never in prompts.

| ID    | Client             | Type            | Max Discount | Max Plan |
|-------|--------------------|-----------------| -------------|----------|
| P-100 | Northwind Capital  | Auto/secured    | 35%          | 6 months |
| P-200 | Apex Card          | Credit card     | 50%          | 12 months|
| P-300 | Harbor Recovery    | Personal pre-legal | 25%       | 18 months|

## Negotiation hierarchy (always offer top-down)
1. Paid in full
2. Balance in payments (full balance, no discount, spread over plan)
3. Settlement (lump sum at discount, up to portfolio max)
4. Payment plan with partial settlement (last resort)

## Plan rules
- Without a financial profile, max plan length = 6 months 
  (even if portfolio allows more)
- Monthly payment = round to cents
- First payment due within 30 days

## Settlement rules
- Discount ≤ portfolio max
- Settlement amount = balance × (1 - discount)
- Paid as lump sum within 30 days OR split into ≤ 3 SIF installments


## Resolution Hierarchy (always offer top-down)

The bot must walk this ladder in order. Only move down when the 
consumer declines or says they can't.

1. **PIF / BIF** — Paid in full / balance in full, ACH today.
2. **BIF in payments** — Full balance split across 2–4 scheduled payments.
3. **SIF** — Settled in full, lump sum, discount ≤ portfolio max.
4. **SIF in payments** — Settlement split across ≤ 3 scheduled payments.
5. **PPA** — Temporary payment plan, then re-evaluate.

## Plan length rules

- **With financial profile collected**: up to portfolio max plan length.
- **Without financial profile**: HARD CAP of 6 months regardless of 
  portfolio max. (Configurable per SOP §3.5.)
- For this prototype, default to NO financial profile collection 
  → 6-month cap applies to all plans.

## Funds verification

- Any single payment > $1,500 → ESCALATE (out of self-service scope).
- Preferred method: ACH / electronic check.

## Payment authorization (Reg E / NACHA)

Before confirming any arrangement, the bot must state:
- Arrangement type
- Each amount
- Each date
- Get explicit YES from the consumer

The bot does NOT collect bank routing/account numbers in self-service.
Once consumer says YES, ESCALATE to a payment specialist (or in a 
real build, hand off to a PCI/NACHA-compliant payment form).
