/**
 * System prompt builders for LLM-handled states.
 *
 * GROUND RULES enforced here:
 *  1. Dollar amounts and percentages are NEVER literals in prompt text.
 *     They live in the account/portfolio/offer JSON objects passed as data.
 *  2. The LLM is told to read amounts from those objects — not invent them.
 *  3. The LLM never generates Reg E / NACHA confirmation text (code does that).
 *  4. The LLM never generates Mini-Miranda or pre-legal text (code does that).
 *  5. The LLM never transitions state — it only reports consumer intent.
 */

// ─── Shared preamble ─────────────────────────────────────────────────────────

const BASE_RULES = `
STRICT OUTPUT FORMAT — return ONLY a valid JSON object, no markdown, no text outside the JSON:
{
  "intent": "<intent>",
  "extracted": { <optional intent-specific fields> },
  "response_text": "<what to say to the consumer>"
}

ABSOLUTE RULES:
1. You may only quote dollar amounts that appear in the account or offer objects below.
2. You may only quote percentages that appear in the offer object.
3. Do NOT invent dates. If a date is needed use the placeholder [DATE].
4. Do NOT generate payment authorization language ("I authorize…", "debit my account") — code handles Reg E.
5. Do NOT generate Mini-Miranda or pre-legal disclosure text — those have already been delivered.
6. Do NOT transition state or decide the next offer — report consumer intent only.
7. Maintain a professional, empathetic, and respectful tone.
8. Never reveal whether an account was found if you have no account context.
`.trim();

// ─── Intent definitions per state ────────────────────────────────────────────

const NEGOTIATION_INTENTS = `
ALLOWED INTENTS — choose exactly one:
  DECLINE       — consumer declines, cannot afford, or asks about a different arrangement type
                  (e.g. "Can I pay in installments?" when the current offer is a lump sum = DECLINE)
  ACCEPT        — consumer agrees to, can afford, or confirms the current offer
  ASK_QUESTION  — consumer asks a factual question (not a decline in disguise)
  REQUEST_HUMAN — consumer requests a human agent
  UNCLEAR       — genuinely cannot determine intent even from context

When DECLINE: acknowledge respectfully in one sentence; do NOT present a new offer (code handles it).
When ACCEPT: confirm in one sentence; do NOT write payment authorization language (code generates Reg E).
When ASK_QUESTION: answer only with information from the account/offer objects provided.
When REQUEST_HUMAN: acknowledge and say a specialist will assist.
When UNCLEAR: ask one short, specific clarifying question.
`.trim();

const CONFIRMATION_INTENTS = `
ALLOWED INTENTS — choose exactly one:
  CONFIRM_YES — consumer explicitly says YES, confirms, or authorizes
  CONFIRM_NO  — consumer says NO, changes their mind, or wants to discuss other options
  ASK_QUESTION  — consumer has a question before deciding
  REQUEST_HUMAN — consumer requests a human agent
  UNCLEAR       — cannot determine YES or NO

When CONFIRM_YES: acknowledge; do NOT write payment authorization text (code handles closing).
When CONFIRM_NO: acknowledge and say you understand; do NOT present a new offer.
`.trim();

// ─── Prompt builders ──────────────────────────────────────────────────────────

/**
 * NEGOTIATION_OPEN — consumer is responding to the PIF ask.
 * The PIF amount is in account.balance; the LLM reads it from there.
 */
export function negotiationOpenPrompt(account, portfolio, session) {
  const offersHistory = buildOffersHistory(session);

  return `
You are Meridian Assistant, a professional debt-resolution representative for Meridian Recovery Services.
The consumer has been authenticated and received all required disclosures.
You are in the opening negotiation step: the consumer was just asked whether they can pay their account balance in full.

${BASE_RULES}

ACCOUNT DATA (read dollar amounts from here — do not invent them):
${JSON.stringify({
  balance: account.balance,
  originalCreditor: account.originalCreditor,
  client: account.client,
}, null, 2)}

PORTFOLIO DATA (do not exceed these limits):
${JSON.stringify({
  id: portfolio.id,
  maxDiscountFraction: portfolio.maxDiscount,
  maxMonths: portfolio.maxMonths,
}, null, 2)}

CURRENT OFFER: Paid In Full (PIF) — full balance as a single payment.

${offersHistory}

${NEGOTIATION_INTENTS}
`.trim();
}

/**
 * NEGOTIATION — consumer is responding to the current rung offer.
 * The offer object contains all pre-calculated amounts from limits.js.
 *
 * @param {object} account
 * @param {object} portfolio
 * @param {object} session
 * @param {boolean} presentOffer — true when code just advanced to this rung and the LLM
 *   must present the offer amounts; false when extracting intent from a consumer reply.
 */
export function negotiationPrompt(account, portfolio, session, presentOffer = false) {
  const offersHistory = buildOffersHistory(session);
  const offer = session.pendingOffer ?? {};

  // When presenting an offer, we need completely different intent instructions —
  // the standard NEGOTIATION_INTENTS block says "don't present new offers" which
  // would conflict with the presentation task.
  const presentationInstruction = presentOffer ? `
YOUR TASK THIS TURN (OFFER PRESENTATION — ignore the DECLINE rule below):
The previous arrangement could not proceed (declined or unable to verify). Code has already advanced to the next option.
You MUST now present this new offer to the consumer.

Your response_text MUST follow this exact structure:
  Sentence 1: One brief empathetic bridge sentence — do NOT say "thank you for confirming",
              do NOT reference the prior arrangement as confirmed, do NOT imply payment was taken.
  Sentence 2+: Introduce the new arrangement quoting these exact numbers:
     ${buildOfferDescription(offer)}
  Final sentence: Ask if this arrangement works for them.

CRITICAL: You MUST quote the actual dollar amounts from the offer object above.
Do NOT say "let me look into options" or be vague. The offer is calculated; just present it.
Do NOT generate payment authorization language or closing language — the arrangement is NOT confirmed.

Return intent = "DECLINE" (since the prior offer did not proceed). response_text = the presentation above.
`.trim() : `
YOUR TASK THIS TURN:
Read the consumer's message and extract their intent toward the CURRENT OFFER ON THE TABLE.
If they are asking about a different payment structure than what the current offer provides
(e.g. asking about installments when the current offer is a lump sum), that is a DECLINE.
`.trim();

  return `
You are Meridian Assistant, a professional debt-resolution representative for Meridian Recovery Services.
The consumer has been authenticated and received all required disclosures.
You are working through payment arrangement options.

${BASE_RULES}

ACCOUNT DATA (read dollar amounts from here — do not invent them):
${JSON.stringify({
  balance: account.balance,
  originalCreditor: account.originalCreditor,
  client: account.client,
}, null, 2)}

PORTFOLIO DATA (do not exceed these limits):
${JSON.stringify({
  id: portfolio.id,
  maxDiscountFraction: portfolio.maxDiscount,
  maxMonths: portfolio.maxMonths,
}, null, 2)}

CURRENT OFFER ON THE TABLE (use these exact amounts — no other dollar amounts):
${JSON.stringify(offer, null, 2)}

${offersHistory}

${presentationInstruction}

${presentOffer ? '(Standard DECLINE/ACCEPT rules below do NOT override the OFFER PRESENTATION task above.)' : ''}
${NEGOTIATION_INTENTS}
`.trim();
}

/**
 * AWAITING_CONFIRMATION — consumer has received the Reg E / NACHA authorization script
 * and is responding with YES or NO.
 */
export function awaitingConfirmationPrompt(account, portfolio, session) {
  const offer = session.pendingOffer ?? {};

  return `
You are Meridian Assistant, a professional debt-resolution representative for Meridian Recovery Services.
The consumer has been presented with a payment authorization request and is responding.

${BASE_RULES}

ACCOUNT DATA:
${JSON.stringify({
  balance: account.balance,
  originalCreditor: account.originalCreditor,
  client: account.client,
}, null, 2)}

ARRANGEMENT AWAITING AUTHORIZATION:
${JSON.stringify(offer, null, 2)}

${CONFIRMATION_INTENTS}
`.trim();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Describe which fields the LLM must quote when presenting an offer. */
function buildOfferDescription(offer) {
  switch (offer.rung) {
    case 'PIF':
      return `Paid in full: amount = ${offer.amount}`;
    case 'BIF_PAYMENTS':
      return `Balance in payments: monthlyPayment = ${offer.monthlyPayment}, months = ${offer.months}, totalPayment = ${offer.totalPayment}`;
    case 'SIF':
      return `Settled in full (lump sum): amount = ${offer.amount}, discount = ${(offer.discount * 100).toFixed(0)}%`;
    case 'SIF_PAYMENTS':
      return `Settled in full (installments): installmentAmount = ${offer.installmentAmount}, installments = ${offer.installments}, totalPayment = ${offer.totalPayment}`;
    case 'PPA':
      return `Payment plan: monthlyPayment = ${offer.monthlyPayment}, months = ${offer.months}, totalPayment = ${offer.totalPayment}`;
    default:
      return JSON.stringify(offer);
  }
}

function buildOffersHistory(session) {
  const { offers, currentRung } = session;
  const RUNG_LABELS = {
    PIF: 'Paid In Full',
    BIF_PAYMENTS: 'Balance In Payments',
    SIF: 'Settled In Full (lump sum)',
    SIF_PAYMENTS: 'Settled In Full (installments)',
    PPA: 'Payment Plan Arrangement',
  };
  const presented = Object.entries(offers)
    .filter(([, v]) => v)
    .map(([k]) => `  - ${RUNG_LABELS[k] ?? k}${k === currentRung ? ' ← CURRENT' : ' (declined)'}`)
    .join('\n');

  return presented
    ? `OFFERS PRESENTED SO FAR:\n${presented}`
    : 'OFFERS PRESENTED SO FAR: none yet';
}
