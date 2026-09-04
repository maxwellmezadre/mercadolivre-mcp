// Typed, non-fatal errors (NFR-6). Every one of them becomes a tool error
// (`isError: true`) at the MCP boundary and a non-zero exit in the CLI —
// never a crash. Messages are actionable and never carry cookie values (NFR-4).

export const LOGIN_HINT =
  "Run `mercadolivre login` (you type the password in the browser; the tool " +
  "only stores the session) or set MERCADOLIVRE_COOKIE.";

export type SessionErrorCode = "NO_SESSION" | "EXPIRED";

/** No usable session, or Mercado Livre answered with its login page (NFR-9). */
export class SessionError extends Error {
  constructor(
    public readonly code: SessionErrorCode,
    detail?: string,
  ) {
    const base =
      code === "NO_SESSION"
        ? "No Mercado Livre session found."
        : "Mercado Livre session expired or rejected.";
    super([base, detail, LOGIN_HINT].filter(Boolean).join(" "));
    this.name = "SessionError";
  }
}

/** Mercado Livre answered with an error status or an error page. */
export class UpstreamError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

/** 403/429 that survived every retry: back off before trying again (NFR-2). */
export class RateLimitError extends UpstreamError {
  constructor(status: number, attempts: number) {
    super(
      status,
      `Mercado Livre refused the request with HTTP ${status} after ${attempts} ` +
        "attempts (rate limited or blocked). Wait a few minutes before retrying.",
    );
    this.name = "RateLimitError";
  }
}
