import { Type } from "@sinclair/typebox";
import { uiTypeOf, walk } from "../mercadolivre/parser/bricks.js";
import { extractNordicCtx } from "../mercadolivre/parser/nordic.js";
import { compactObject, defineTool } from "./define.js";

// F-16: rediscovery escape hatch. When Mercado Livre changes its layout, this
// lets the model look at the real payload (spec appendix B) without a browser.
// GET only, allowlisted hosts only, output capped so it never floods the context.

export const ALLOWED_HOSTS = [
  "myaccount.mercadolivre.com.br",
  "www.mercadolivre.com.br",
] as const;

const FLOX_STATE_KEY = "@meli/web/flox/FLOX_STATE";
const DEFAULT_MAX_BYTES = 64 * 1024;

/** Absolute URL on an allowed host; relative paths resolve against myaccount. */
export function resolveAllowedUrl(input: string): string {
  const url = new URL(input, `https://${ALLOWED_HOSTS[0]}`);
  if (url.protocol !== "https:" || !(ALLOWED_HOSTS as readonly string[]).includes(url.host)) {
    throw new Error(
      `Host não permitido: ${url.host}. Hosts aceitos: ${ALLOWED_HOSTS.join(", ")}`,
    );
  }
  return url.toString();
}

function cap(text: string, max: number) {
  return text.length > max
    ? { truncated: true, totalBytes: text.length, body: text.slice(0, max) }
    : { truncated: false, body: text };
}

export const rawGet = defineTool({
  name: "raw_get",
  description:
    "GET autenticado num host permitido do Mercado Livre (myaccount.mercadolivre.com.br, www.mercadolivre.com.br), " +
    "para redescobrir endpoints quando o site mudar. Só GET, nunca escreve na conta. as=html devolve o texto da " +
    "página, as=json interpreta um endpoint JSON, as=nordic extrai a árvore de bricks renderizada no servidor e um " +
    "censo de ui_type. A saída é limitada por maxBytes. Gasta 1 requisição.",
  readOnly: true,
  input: Type.Object({
    url: Type.String({
      description: "URL absoluta ou caminho (caminhos resolvem contra myaccount.mercadolivre.com.br)",
    }),
    as: Type.Optional(
      Type.Union([Type.Literal("html"), Type.Literal("json"), Type.Literal("nordic")], {
        description: "Como ler a resposta (default html)",
      }),
    ),
    maxBytes: Type.Optional(
      Type.Integer({
        minimum: 1024,
        maximum: 1_000_000,
        description: "Máximo de caracteres devolvidos em body (default 65536)",
      }),
    ),
  }),
  run: async (args, ctx) => {
    const url = resolveAllowedUrl(args.url);
    const mode = args.as ?? "html";
    const max = args.maxBytes ?? DEFAULT_MAX_BYTES;
    const result = await ctx.http.get(url, { kind: mode === "json" ? "json" : "html" });
    const base = { status: result.status, url: result.url, contentType: result.contentType };

    if (mode === "json") {
      try {
        return compactObject({ ...base, json: JSON.parse(result.body) as unknown });
      } catch {
        return compactObject({ ...base, ...cap(result.body, max) });
      }
    }

    if (mode === "nordic") {
      const pageProps = extractNordicCtx(result.body).appProps?.pageProps ?? {};
      const root = pageProps.floxResponse?.data?.brick;
      const stack = pageProps.floxPreloadedState?.[FLOX_STATE_KEY]?.brickStack;
      const bricks = root ? [...walk(root)] : stack ? Object.values(stack) : [];
      const census: Record<string, number> = {};
      for (const brick of bricks) {
        const type = uiTypeOf(brick) ?? "?";
        census[type] = (census[type] ?? 0) + 1;
      }
      return compactObject({
        ...base,
        census,
        ...cap(JSON.stringify(root ?? stack ?? pageProps), max),
      });
    }

    return compactObject({ ...base, ...cap(result.body, max) });
  },
});
