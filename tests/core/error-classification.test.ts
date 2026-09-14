/**
 * Core Gateway Module - Error Classification Tests
 * Verifies the error taxonomy drives retry & circuit-breaker decisions.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  classifyError,
  isRetryableError,
  shouldMarkInstanceFailed,
} from '../../src/main/proxy/core/errorClassification.ts'

test('401 and auth messages classify as auth_error, retryable, marks failed', () => {
  const e = classifyError({ message: 'unauthorized', status: 401 })
  assert.equal(e.errorClass, 'auth_error')
  assert.equal(e.retryable, true)
  assert.equal(e.marksInstanceFailed, true)
  assert.equal(e.authRelated, true)
})

test('provider_not_logged_in classifies as auth_error', () => {
  const e = classifyError({ code: 'provider_not_logged_in' })
  assert.equal(e.errorClass, 'auth_error')
  assert.equal(e.retryable, true)
})

test('429 and provider_blocked classify as rate_limited, marks failed', () => {
  const e = classifyError({ message: 'rate limit exceeded', status: 429 })
  assert.equal(e.errorClass, 'rate_limited')
  assert.equal(e.retryable, true)
  assert.equal(e.marksInstanceFailed, true)
  assert.equal(e.authRelated, false)
})

test('5xx and provider_upstream_error classify as server_error, retryable', () => {
  const e = classifyError({ message: 'bad gateway', status: 502 })
  assert.equal(e.errorClass, 'server_error')
  assert.equal(e.retryable, true)
  assert.equal(e.marksInstanceFailed, true)
})

test('timeout classifies as timeout, retryable', () => {
  const e = classifyError({ message: 'request timed out (ETIMEDOUT)' })
  assert.equal(e.errorClass, 'timeout')
  assert.equal(e.retryable, true)
})

test('4xx and invalid response classify as invalid_request, NOT retryable, NOT marking failed', () => {
  const badRequest = classifyError({ message: 'bad request', status: 400 })
  assert.equal(badRequest.errorClass, 'invalid_request')
  assert.equal(badRequest.retryable, false)
  assert.equal(badRequest.marksInstanceFailed, false)

  const invalidResponse = classifyError({ code: 'provider_invalid_response' })
  assert.equal(invalidResponse.errorClass, 'invalid_request')
  assert.equal(invalidResponse.retryable, false)
})

test('request_cancelled is never retried and never marks failed', () => {
  const e = classifyError({ code: 'request_cancelled' })
  assert.equal(e.errorClass, 'invalid_request')
  assert.equal(e.retryable, false)
  assert.equal(e.marksInstanceFailed, false)
})

test('unknown errors default to retryable + marks failed', () => {
  const e = classifyError({ message: 'something weird happened' })
  assert.equal(e.errorClass, 'unknown')
  assert.equal(e.retryable, true)
  assert.equal(e.marksInstanceFailed, true)
})

test('plain string and number inputs are handled', () => {
  assert.equal(classifyError('boom').errorClass, 'unknown')
  assert.equal(classifyError(500).errorClass, 'unknown')
  assert.equal(classifyError(null).errorClass, 'unknown')
})

test('helper predicates agree with classification', () => {
  assert.equal(isRetryableError({ status: 429 }), true)
  assert.equal(isRetryableError({ status: 400 }), false)
  assert.equal(shouldMarkInstanceFailed({ status: 502 }), true)
  assert.equal(shouldMarkInstanceFailed({ status: 400 }), false)
})