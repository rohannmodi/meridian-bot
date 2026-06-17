# Compliance Scripts (verbatim — do not paraphrase)

All scripts below come from the Meridian Recovery Services SOP.
Variables in [BRACKETS] are filled by code from the account record.

## 1. Inbound greeting (first message, before anything)
"Thank you for contacting Meridian Recovery Services. My name is 
Meridian Assistant. This conversation may be monitored and recorded; 
by continuing you are providing your consent. How may I help you?"

## 2. Authentication prompt (digital self-service standard)
"To access your account, please provide:
1. Your account reference number
2. Your first and last name
3. The last 4 digits of your SSN
4. Your ZIP code"

## 3. Authentication failure (after 3 attempts)
"I'm unable to verify your identity. For your security, I can't 
share any account details — including whether an account exists. 
I'll connect you with a representative who can help, or you can 
reach us through our published contact channels."

## 4. Mini-Miranda (verbatim, after auth success)
"This is a communication from a debt collector. This is an attempt 
to collect a debt, and any information obtained, including this 
call recording, will be used for that purpose."

## 5. Collector statement (after Mini-Miranda)
"I am with Meridian Recovery Services on behalf of [CLIENT] in 
regard to your [ORIGINAL_CREDITOR] account. Your account was 
placed with our office as of [RECEIVE_DATE] and reflects a balance 
of [BALANCE]. It is my goal to resolve this with you in a courteous 
and professional manner. How can I help you resolve your balance today?"

## 6. Pre-legal disclosure (P-300 only, after collector statement)
"Please be advised that your account has been placed with our office 
in a pre-legal status. Failure to resolve this matter may result in 
your account being reviewed by an attorney in your state for possible 
legal action to collect the balance due."

SUPPRESS this disclosure if:
- a prior arrangement has been breached, OR
- the contact is about an NSF (returned) payment

## 7. Escalation message (any special flag, or auth failure)
"I need to transfer you to a specialist who can assist with your 
account. Please hold while I connect you, or you can reach us 
through our published contact channels."

## 8. Settlement confirmation + payment authorization (Reg E / NACHA)
"To confirm the arrangement:
- Settlement amount: $[AMOUNT]
- Payment date: [DATE]
- Payment method: ACH from your bank account

By confirming, you authorize Meridian Recovery Services to debit 
your account for this amount on the date shown. Changes must be 
requested by 11 AM the day before the scheduled post.

Reply YES to authorize, or NO to discuss other options."

## 9. Plan confirmation + payment authorization
"To confirm the arrangement:
- $[MONTHLY] per month for [N] months
- First payment: [FIRST_DATE]
- Total: $[TOTAL]
- Payment method: ACH from your bank account

By confirming, you authorize Meridian Recovery Services to debit 
your account on each scheduled date. Changes must be requested 
by 11 AM the day before any scheduled post.

Reply YES to authorize, or NO to discuss other options."

## 10. Closing
"Is there anything else I can help you with today? If you have 
further questions, you can reach us through the agency's published 
contact channels."

## 11. Funds verification trigger
For any single payment over $1,500, the bot must add:
"Because this payment is over $1,500, I'll need to verify funds 
availability before processing. I'll transfer you to a specialist 
to complete this."
→ ESCALATE
