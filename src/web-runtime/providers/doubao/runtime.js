'use strict';

/**
 * Doubao (www.doubao.com/chat) runtime.
 *
 * Login state is inferred from the chat input box: when the assistant
 * composer is visible the user is signed in. `connect` opens the chat page,
 * waits for that signal, then persists the browser session; `healthCheck`
 * probes it without navigating; `sendMessage` types into the composer,
 * submits, and waits for the latest assistant reply.
 */

const CHAT_URL = 'https://www.doubao.com/chat';
const INPUT_SELECTOR = 'textarea[placeholder*="输入"]';
const SEND_BUTTON_SELECTOR = 'button[class*="send"]';
const ASSISTANT_SELECTOR = 'div[class*="assistant"]';

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

/**
 * Send one user message and return the newest assistant reply.
 * A wait-for-reply timeout yields an error result with `ok: false` instead
 * of throwing, so callers get a structured failure to surface to the user.
 */
async function sendMessage({ message, page }) {
  const input = page.locator(INPUT_SELECTOR);
  await input.fill(message, { timeout: SEND_TIMEOUT_MS });
  await page.locator(SEND_BUTTON_SELECTOR).click({ timeout: SEND_TIMEOUT_MS });

  let reply;
  try {
    await page.waitForSelector(ASSISTANT_SELECTOR, { timeout: REPLY_TIMEOUT_MS });
  } catch {
    return {
      ok: false,
      content: '',
      finishReason: 'stop',
      error: `reply not detected within ${REPLY_TIMEOUT_MS}ms`,
    };
  }
  reply = await page.locator(ASSISTANT_SELECTOR).last().innerText();
  return { ok: true, content: reply, finishReason: 'stop' };
}

module.exports = { connect, healthCheck, sendMessage };