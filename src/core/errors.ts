// Typed, non-fatal errors (NFR-6). Every one of them becomes a tool error
// (`isError: true`) at the MCP boundary and a non-zero exit in the CLI,
// never a crash. Messages are user-facing (pt-BR), actionable and never carry
// cookie values (NFR-4).

export const LOGIN_HINT =
  "Rode `mercadolivre login` no terminal (você digita a senha no navegador; a ferramenta " +
  "só guarda a sessão), ou `mercadolivre login --from-browser chrome` para importar a " +
  "sessão de um navegador já logado, ou defina MERCADOLIVRE_COOKIE.";

export type SessionErrorCode = "NO_SESSION" | "EXPIRED" | "UNREADABLE";

const SESSION_MESSAGES: Record<SessionErrorCode, string> = {
  NO_SESSION: "Nenhuma sessão do Mercado Livre salva.",
  EXPIRED: "A sessão do Mercado Livre expirou ou foi recusada.",
  UNREADABLE: "Não foi possível ler a sessão salva.",
};

/** No usable session, or Mercado Livre answered with its login page (NFR-9). */
export class SessionError extends Error {
  constructor(
    public readonly code: SessionErrorCode,
    detail?: string,
  ) {
    super([SESSION_MESSAGES[code], detail, LOGIN_HINT].filter(Boolean).join(" "));
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
      `O Mercado Livre recusou a requisição com HTTP ${status} depois de ${attempts} ` +
        "tentativas (rate limit ou bloqueio). Espere alguns minutos antes de tentar de novo.",
    );
    this.name = "RateLimitError";
  }
}

/** The page or payload does not have the shape we know (layout changed?). */
export class ParseError extends Error {
  constructor(message: string) {
    super(`${message} Rode \`mercadolivre doctor\` para ver qual camada quebrou.`);
    this.name = "ParseError";
  }
}

/** The interactive login or the browser import did not complete. */
export class LoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoginError";
  }
}
