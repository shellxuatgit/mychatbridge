'use strict';

/**
 * ChatGPT (chatgpt.com) runtime.
 *
 * Login state is inferred from the prompt composer: when `#prompt-textarea`
 * is available the user is signed in. `connect` opens the site, waits for
 * that signal, then persists the browser session; `healthCheck` probes it
 * without navigating; `sendMessage` types into the composer, submits, and
 * waits for the latest assistant message.
 */

const CHAT_URL = 'https://chatgpt.com';
const INPUT_SELECTOR = '#prompt-textarea';
const SEND_BUTTON_SELECTOR = 'button[data-testid="send-button"]';
const ASSISTANT_SELECTOR = 'div[data-message-author-role="assistant"]';

const CONNECT_TIMEOUT_MS = 120000; // login signal
const NAV_TIMEOUT_MS = 60000;
const SEND_TIMEOUT_MS = 15000; // playwright defaults to 30s without this
const REPLY_TIMEOUT_MS = 120000;

/**
 * Open the chat page and wait until the composer shows we are signed in.
 * Session persistence happens in ProviderRuntime (saveSession) after this
 * returns ok, so the runtime itself only needs to confirm login state.
 */
async function connect({ page }) {
  await page.goto(CHAT_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  await page.waitForSelector(INPUT_SELECTOR, { timeout: CONNECT_TIMEOUT_MS });
  return { ok: true };
}

/** Probe the current page for a live session without navigating. */
async function healthCheck({ page }) {
  const visible = await page
    .locator(INPUT_SELECTOR)
    .isVisible()
    .catch(() => false);
  return { status: visible ? 'ok' : 'logged_out' };
}

/** Most recent assistant message at or before the newly submitted one. */
function latestAssistant(page) {
  return page.locator(ASSISTANT_SELECTOR).last();
}

/**
 * Send one user message and return the newest assistant reply.
 * A wait-for-reply timeout yields an error result with `ok: false` instead
 * of throwing, so callers get a structured failure to surface to the user.
 */
async function sendMessage({ message, page }) {
  const input = page.locator(INPUT_SELECTOR);
  const visible = await input.isVisible().catch(() => false);
  if (!visible) {
    return {
      ok: false,
      content: '',
      finishReason: 'stop',
      error: 'composer not visible; are you logged in?',
    };
  }
  const reply = latestAssistant(page);
  const before = await reply.count();

  await input.fill(message, { timeout: SEND_TIMEOUT_MS });
  await page.locator(SEND_BUTTON_SELECTOR).click({ timeout: SEND_TIMEOUT_MS });
  await page.waitForSelector(INPUT_SELECTOR, { timeout: SEND_TIMEOUT_MS }); // composer re-enabled

  let newReply;
  try {
    await page.waitForFunction(
      ({ selector, before }) => document.querySelectorAll(selector).length > before,
      { selector: ASSISTANT_SELECTOR, before },
      { timeout: REPLY_TIMEOUT_MS },
    );
  } catch {
    return {
      ok: false,
      content: '',
      finishReason: 'stop',
      error: `reply not detected within ${REPLY_TIMEOUT_MS}ms`,
    };
  }
  newReply = await page.locator(ASSISTANT_SELECTOR).last().innerText();
  return { ok: true, content: newReply, finishReason: 'stop' };
}

module.exports = { connect, healthCheck, sendMessage };