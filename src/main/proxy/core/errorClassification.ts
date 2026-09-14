/**
 * Core Gateway Module - Error Classification
 *
 * Classifies upstream/provider failures into retry & circuit-breaker decisions,
 * implementing the "smart failover" rules:
 *
 *   401             → auth failure (refresh auth / switch instance, retry)
 *   403             → disable instance (permission denied, do NOT retry same instance)
 *   429             → rate limited (cool down, may retry another instance)
 *   5xx             → transient upstream error (retry another instance)
 *   timeout         → transient (retry another instance)
 *   captcha/blocked → quarantine (treat as permanent for the instance)
 *   invalid request → DO NOT retry
 */

export type ErrorClass =
  | 'auth_error'
  | 'rate_limited'
  | 'server_error'
  | 'timeout'
  | 'blocked'
  | 'invalid_request'
  | 'unknown'

export interface ClassifiedError {
  code: string
  message: string
  /** Error class used for retry / circuit-breaker policy */
  errorClass: ErrorClass
  /** Whether retrying (possibly on a different instance) may succeed */
  retryable: boolean
  /** Whether this instance should be marked failed (circuit breaker) */
  marksInstanceFailed: boolean
  /** Whether the failure suggests the credentials are invalid (refresh/disable) */
  authRelated: boolean
}

const CLASSIFIERS: Array<{ match: (e: any) => boolean; result: ClassifiedError }> = [
  {
    match: (e) => e?.code === 'request_cancelled',
    result: {
      code: 'request_cancelled',
      message: 'Request was cancelled',
      errorClass: 'invalid_request',
      retryable: false,
      marksInstanceFailed: false,
      authRelated: false,
    },
  },
  {
    match: (e) =>
      e?.code === 'provider_not_logged_in' ||
      e?.status === 401 ||
      e?.status === 403 ||
      /unauthorized|forbidden|not logged|invalid.*token|expired.*token|auth/i.test(e?.message ?? ''),
    result: {
      code: 'auth_error',
      message: 'Authentication failed',
      errorClass: 'auth_error',
      retryable: true,
      marksInstanceFailed: true,
      authRelated: true,
    },
  },
  {
    match: (e) =>
      e?.code === 'provider_blocked' ||
      e?.status === 429 ||
      /rate.?limit|too many|blocked|captcha|429/i.test(e?.message ?? ''),
    result: {
      code: 'rate_limited',
      message: 'Rate limited or blocked',
      errorClass: 'rate_limited',
      retryable: true,
      marksInstanceFailed: true,
      authRelated: false,
    },
  },
  {
    match: (e) =>
      e?.code === 'provider_timeout' ||
      /timeout|timed out|etimedout|esockettimedout/i.test(e?.message ?? ''),
    result: {
      code: 'timeout',
      message: 'Upstream timed out',
      errorClass: 'timeout',
      retryable: true,
      marksInstanceFailed: true,
      authRelated: false,
    },
  },
  {
    match: (e) =>
      (e?.status && e.status >= 500 && e.status < 600) ||
      e?.code === 'provider_upstream_error',
    result: {
      code: 'server_error',
      message: 'Upstream server error',
      errorClass: 'server_error',
      retryable: true,
      marksInstanceFailed: true,
      authRelated: false,
    },
  },
  {
    match: (e) =>
      (e?.status && e.status >= 400 && e.status < 500) ||
      e?.code === 'provider_invalid_response' ||
      e?.code === 'capability_not_supported',
    result: {
      code: 'invalid_request',
      message: 'Invalid request or unsupported capability',
      errorClass: 'invalid_request',
      retryable: false,
      marksInstanceFailed: false,
      authRelated: false,
    },
  },
]

/**
 * Classify an error object (or the string/number form) into a policy decision.
 * Always returns a ClassifiedError (never throws).
 */
export function classifyError(error: unknown): ClassifiedError {
  const e: any =
    typeof error === 'object' && error !== null
      ? error
      : { message: typeof error === 'string' ? error : String(error) }

  for (const classifier of CLASSIFIERS) {
    if (classifier.match(e)) {
      return { ...classifier.result }
    }
  }

  return {
    code: 'unknown',
    message: e?.message ?? 'Unknown error',
    errorClass: 'unknown',
    retryable: true,
    marksInstanceFailed: true,
    authRelated: false,
  }
}

/** Convenience: is this error worth retrying on another instance? */
export function isRetryableError(error: unknown): boolean {
  return classifyError(error).retryable
}

/** Convenience: should this failure trip the instance circuit breaker? */
export function shouldMarkInstanceFailed(error: unknown): boolean {
  return classifyError(error).marksInstanceFailed
}
