import { Type } from "@sinclair/typebox";
import { LOGIN_HINT, SessionError } from "../core/errors.js";
import { LIST_PAGE_URL } from "../core/http.js";
import { compactObject, defineTool } from "./define.js";

// F-1: session status. Free by default (reads the session file and says
// nothing that could not be derived from it); with `verify` it spends one
// request to prove Mercado Livre still accepts it.

export const authStatus = defineTool({
  name: "auth_status",
  description:
    "Diz se há uma sessão do Mercado Livre salva e o que ela cobre (origem, apelido, id do usuário, " +
    "quantidade e validade dos cookies). Não usa a rede por padrão. Com verify=true gasta 1 requisição " +
    "à página de compras para confirmar que o site ainda aceita a sessão. Comece por aqui quando outra " +
    "tool reclamar de sessão.",
  readOnly: true,
  input: Type.Object({
    verify: Type.Optional(
      Type.Boolean({
        description: "Também faz 1 requisição à página de compras para confirmar que a sessão é aceita",
      }),
    ),
  }),
  run: async (args, ctx) => {
    const { session } = ctx;
    let cookies: readonly import("../session/store.js").SessionCookie[] = [];
    try {
      cookies = session.hasSession() ? session.cookies() : [];
    } catch (error) {
      // An unreadable session file is a status, not a crash: this tool exists to report it.
      if (!(error instanceof SessionError)) throw error;
      return compactObject({
        loggedIn: false,
        source: "none",
        sessionFile: session.path,
        cookieCount: 0,
        httpOnlyCount: 0,
        error: error.message,
      });
    }
    let loggedIn = cookies.length > 0;
    let verified: boolean | undefined;

    if (args.verify && loggedIn) {
      try {
        await ctx.http.get(LIST_PAGE_URL, { kind: "html" });
        verified = true;
      } catch (error) {
        if (!(error instanceof SessionError)) throw error;
        verified = false;
        loggedIn = false;
      }
    }

    const expiries = cookies
      .filter((cookie) => cookie.expires > 0)
      .map((cookie) => cookie.expires);
    const valueOf = (name: string) =>
      cookies.find((cookie) => cookie.name === name)?.value;
    const savedAt = session.meta().savedAt;

    return compactObject({
      loggedIn,
      verified,
      source: session.source(),
      sessionFile: session.path,
      cookieCount: cookies.length,
      httpOnlyCount: cookies.filter((cookie) => cookie.httpOnly).length,
      nickname: valueOf("orgnickp"),
      userId: valueOf("orguserid"),
      savedAt,
      ageDays: savedAt ? Math.floor((ctx.now().getTime() - Date.parse(savedAt)) / 86_400_000) : undefined,
      soonestExpiry:
        expiries.length > 0
          ? new Date(Math.min(...expiries) * 1000).toISOString()
          : undefined,
      hint: loggedIn ? undefined : LOGIN_HINT,
    });
  },
});
