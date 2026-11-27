export type ErrorKind = "validation" | "network" | "timeout" | "parse" | "api" | "permission" | "unknown";

/**
 * Error whose message is safe to show to the user: it never carries the API token or a raw
 * response body. Lower layers throw this; the UI only ever renders `message`.
 */
export class UserError extends Error {
  readonly kind: ErrorKind;
  readonly status?: number;

  constructor(kind: ErrorKind, message: string, options?: { status?: number; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "UserError";
    this.kind = kind;
    this.status = options?.status;
  }
}

const GENERIC_MESSAGE = "Something went wrong.";

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

/** Removes any occurrence of a known secret from text before it reaches a toast or log. */
export function redact(text: string, secrets: readonly string[]): string {
  return secrets.filter(Boolean).reduce((result, secret) => result.split(secret).join("***"), text);
}

export function toUserMessage(error: unknown, secrets: readonly string[] = []): string {
  if (error instanceof UserError) {
    return redact(error.message, secrets);
  }

  if (isAbortError(error)) {
    return "The request timed out.";
  }

  if (error instanceof TypeError) {
    return "Could not reach the service. Check the URL and your connection.";
  }

  if (error instanceof Error) {
    return redact(error.message, secrets) || GENERIC_MESSAGE;
  }

  return GENERIC_MESSAGE;
}
