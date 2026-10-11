export enum ExitCode {
  Success = 0,
  Usage = 2,
  Auth = 3,
  Conflict = 4,
  Service = 5,
  Approval = 6,
  Budget = 7,
}

export class CliError extends Error {
  constructor(message: string, public readonly exitCode = ExitCode.Service, public readonly details?: unknown, public readonly httpStatus?: number) {
    super(message);
    this.name = "CliError";
  }
}

const sensitiveKey = /authorization|api.?key|(^|_)key$|(^|_)token$|jwt|access.?token|refresh.?token|secret|password|cookie|signed.?url/i;
export function redact(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/Bearer\s+(?!\$)[^\s'",}]+/gi, "Bearer [REDACTED]")
      .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-[REDACTED]")
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED-JWT]")
      .replace(/([?&](?:X-Amz-[^=]+|Signature|token)\=)[^&\s]+/gi, "$1[REDACTED]");
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, !["idempotencyKey", "idempotency_key"].includes(key) && sensitiveKey.test(key) ? "[REDACTED]" : redact(item)]));
  }
  return value;
}

export function classifyHttpError(status: number, body: unknown): CliError {
  const rawMessage = typeof body === "object" && body && "message" in body ? String((body as { message: unknown }).message) : `HTTP ${status}`;
  const message = String(redact(rawMessage));
  if (status === 401 || status === 403) return new CliError(message, ExitCode.Auth, redact(body), status);
  if (status === 409) return new CliError(`${message}. Refresh state and replay with the new baseVersion; no overwrite was attempted.`, ExitCode.Conflict, redact(body), status);
  if (status === 400 || status === 422) return new CliError(message, ExitCode.Usage, redact(body), status);
  return new CliError(message, ExitCode.Service, redact(body), status);
}

// Servers commonly replace the generic "HTTP 404" text with their own message, so
// optional-endpoint detection has to read the status out of the error body too.
export function isNotFound(error: unknown): boolean {
  if (!(error instanceof CliError)) return false;
  if (error.httpStatus === 404) return true;
  if (/HTTP 404/.test(error.message)) return true;
  const details = error.details as Record<string, unknown> | undefined;
  if (!details) return false;
  return Number(details.statusCode ?? details.status) === 404 || /notfound/i.test(String(details.diagnosticCode || ""));
}
