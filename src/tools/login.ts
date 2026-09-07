import { Type } from "@sinclair/typebox";
import { IMPORT_BROWSERS } from "../config.js";
import { importFromBrowser } from "../session/browser-import.js";
import { interactiveLogin } from "../session/login.js";
import { authStatus } from "./auth.js";
import { defineTool, runTool } from "./define.js";

// Login as an MCP tool as well as a CLI command: the browser window opens on
// the machine running the server and the call blocks until the user is done.
// The CLI is still the primary path; some MCP clients time out first.

export const login = defineTool({
  name: "login",
  description:
    "Abre o navegador padrão para o usuário entrar na conta do Mercado Livre e guarda a sessão " +
    "cifrada (a senha nunca passa por aqui). Bloqueia até a lista de compras carregar, por até 5 minutos. " +
    "Com from_browser, importa a sessão de um navegador já logado (macOS) em vez de abrir a janela. " +
    "Prefira o comando de terminal `mercadolivre login` quando o cliente MCP tiver timeout curto. " +
    "Gasta 1 requisição no fim para confirmar que o site aceita a sessão.",
  readOnly: false,
  input: Type.Object({
    fresh: Type.Optional(
      Type.Boolean({ description: "Apaga o perfil do navegador de automação antes (login do zero)" }),
    ),
    from_browser: Type.Optional(
      Type.Union(
        IMPORT_BROWSERS.map((browser) => Type.Literal(browser)),
        { description: "Importa os cookies de um navegador já logado (só macOS) em vez de abrir uma janela" },
      ),
    ),
  }),
  run: async (args, ctx) => {
    const browser = args.from_browser ?? ctx.config.importBrowser;
    const result = browser
      ? await importFromBrowser(ctx, { browser, ...(args.fresh ? { fresh: true } : {}) })
      : await interactiveLogin(ctx, { ...(args.fresh ? { fresh: true } : {}) });
    // Prove the session works before telling anyone it is ready (1 request).
    const status = await runTool(authStatus, { verify: true }, ctx);
    return { ...result, status };
  },
});
