/**
 * Anthropic SDK wrapper.
 * The LLM is ONLY called in NEGOTIATION_OPEN, NEGOTIATION, and AWAITING_CONFIRMATION states.
 * It returns structured JSON — never plain text. Code validates and acts on the result.
 *
 * Expected response shape:
 * {
 *   "intent": "DECLINE" | "ACCEPT" | "ASK_QUESTION" | "REQUEST_HUMAN" |
 *             "CONFIRM_YES" | "CONFIRM_NO" | "UNCLEAR",
 *   "extracted": { ...intent-specific fields... },
 *   "response_text": "what to say to the consumer"
 * }
 */

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Call the LLM and return parsed JSON.
 * Throws if the response is not valid JSON or missing required fields.
 *
 * @param {string} systemPrompt
 * @param {{ role: 'user'|'bot', content: string }[]} history  – recent turns only
 * @param {string} userMessage  – current consumer message
 * @param {{ role: 'user'|'assistant', content: string }[]} correctionMessages
 *   Extra turns appended after userMessage — used by the guardrail retry loop
 *   to feed back the prior LLM response + a corrective instruction.
 * @returns {{ intent: string, extracted: object, response_text: string }}
 */
export async function callLLM(systemPrompt, history, userMessage, correctionMessages = []) {
  // Convert history to Anthropic message format.
  // Only include turns with actual text content (skip empty greeting turns).
  const messages = [];
  for (const h of history) {
    if (!h.content?.trim()) continue;
    messages.push({
      role: h.role === 'bot' ? 'assistant' : 'user',
      content: h.content,
    });
  }
  if (userMessage?.trim()) {
    // If the last message in history is also a user turn (e.g. consumer said "YES"
    // and doVerifyFunds failed, then wants to present a new offer via advanceAndPresent),
    // we must bridge with a minimal assistant turn to maintain alternation.
    if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
      messages.push({ role: 'assistant', content: 'One moment...' });
    }
    messages.push({ role: 'user', content: userMessage });
  } else {
    // Empty userMessage: ensure the array ends on a user turn (API requirement).
    // If history already ends on user (normal case), no placeholder is needed.
    if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
      messages.push({ role: 'user', content: '[Please present the next arrangement option.]' });
    }
  }

  // Append correction context for retry attempts (roles are already Anthropic-format)
  for (const cm of correctionMessages) {
    messages.push({ role: cm.role, content: cm.content });
  }

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });

  const raw = response.content[0].text.trim();

  // Strip markdown code fences if the model wraps output anyway
  const jsonText = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(`LLM did not return valid JSON.\nRaw output: ${raw.slice(0, 300)}`);
  }

  // Validate required fields
  if (typeof parsed.intent !== 'string') {
    throw new Error(`LLM response missing "intent". Got: ${JSON.stringify(parsed).slice(0, 200)}`);
  }
  if (typeof parsed.response_text !== 'string') {
    throw new Error(`LLM response missing "response_text". Got: ${JSON.stringify(parsed).slice(0, 200)}`);
  }
  if (!parsed.extracted || typeof parsed.extracted !== 'object') {
    parsed.extracted = {};
  }

  return parsed;
}
