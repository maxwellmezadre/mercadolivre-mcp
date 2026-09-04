import { Type } from "@sinclair/typebox";
import { LOGIN_HINT, SessionError } from "../core/errors.js";
import { LIST_PAGE_URL } from "../core/http.js";
import { compactObject, defineTool } from "./define.js";

// F-1: session status. Cheap by default (reads the session file); with
// `verify` it spends one request to prove Mercado Livre still accepts it.

export const authStatus = defineTool({
  name: "auth_status",
  description:
    "Checks whether a Mercado Livre session is configured and, with verify=true, whether the site still accepts it. " +
    "Returns the session source, nickname, user id, cookie count and the earliest cookie expiry. " +
    "Start here when another tool reports a session problem.",
  readOnly: true,
  input: Type.Object({
    verify: Type.Optional(
      Type.Boolean({
        description:
          "Also perform one request to the purchases page to confirm the session is accepted (default false)",
      }),
    ),
  }),
  run: async (args, ctx) => {
    const { session } = ctx;
    const cookies = session.hasSession() ? session.cookies() : [];
    let authenticated = cookies.length > 0;
    let verified: boolean | undefined;

    if (args.verify && authenticated) {
      try {
        await ctx.http.get(LIST_PAGE_URL, { kind: "html" });
        verified = true;
      } catch (error) {
        if (!(error instanceof SessionError)) throw error;
        verified = false;
        authenticated = false;
      }
    }

    const expiries = cookies
      .filter((cookie) => cookie.expires > 0)
      .map((cookie) => cookie.expires);
    const valueOf = (name: string) =>
      cookies.find((cookie) => cookie.name === name)?.value;

    return compactObject({
      authenticated,
      verified,
      source: session.source(),
      sessionFile: session.path,
      cookieCount: cookies.length,
      nickname: valueOf("orgnickp"),
      userId: valueOf("orguserid"),
      earliestCookieExpiry:
        expiries.length > 0
          ? new Date(Math.min(...expiries) * 1000).toISOString()
          : undefined,
      savedAt: session.meta().savedAt,
      hint: authenticated ? undefined : LOGIN_HINT,
    });
  },
});
