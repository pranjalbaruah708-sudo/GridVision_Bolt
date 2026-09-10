type AuthErrorLike = {
  code?: unknown;
  message?: unknown;
  status?: unknown;
};

const RATE_LIMIT_CODES = new Set([
  'over_request_rate_limit',
  'over_email_send_rate_limit',
  'rate_limit_exceeded',
]);

const CAPTCHA_CODES = new Set([
  'captcha_failed',
  'captcha_verification_failed',
]);

function details(error: unknown): AuthErrorLike {
  return error && typeof error === 'object' ? error as AuthErrorLike : {};
}

function message(error: unknown) {
  const value = details(error).message;
  return typeof value === 'string' ? value.toLowerCase() : '';
}

export function isAuthRateLimitError(error: unknown) {
  const { status, code } = details(error);
  if (status === 429) return true;
  if (typeof code === 'string' && RATE_LIMIT_CODES.has(code.toLowerCase())) return true;
  return /rate limit|too many requests/i.test(message(error));
}

export function isInvalidCredentialsError(error: unknown) {
  return /invalid credentials|invalid login|wrong password/i.test(message(error));
}

export function isAuthCaptchaError(error: unknown) {
  const { code } = details(error);
  if (typeof code === 'string' && CAPTCHA_CODES.has(code.toLowerCase())) return true;
  return /captcha|turnstile|security verification/i.test(message(error));
}

export function isAuthConnectivityError(error: unknown) {
  return /network|fetch|connection|offline|timeout/i.test(message(error));
}
