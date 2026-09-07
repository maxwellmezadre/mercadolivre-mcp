import { Type } from "@sinclair/typebox";
import { runSync } from "../cache/sync.js";
import { defineTool } from "./define.js";

// F-14: the only tool that talks to Mercado Livre in volume. Every query
// tool reads the cache this one fills (AR-6). Writes the local cache, so it
// is not read-only from the disk's point of view.

export const sync = defineTool({
  name: "sync",
  description:
    "Sincroniza o cache local com o histórico de compras do Mercado Livre (a conta é só lida). " +
    "mode=incremental (default) atualiza as páginas mais novas e as compras não finais; mode=full percorre " +
    "todas as páginas e categorias (faça uma vez; ~70 compras levam cerca de 3 minutos, a uma requisição " +
    "por segundo); mode=reparse reprocessa as páginas em cache sem rede. Devolve um relatório com contagens, " +
    "avisos e erros. Não chame em paralelo com outras tools de rede.",
  readOnly: false,
  input: Type.Object({
    mode: Type.Optional(
      Type.Union([Type.Literal("incremental"), Type.Literal("full"), Type.Literal("reparse")], {
        description: "incremental (default), full ou reparse",
      }),
    ),
    maxPages: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 100, description: "Teto de páginas da lista por passada (default 10)" }),
    ),
    withDetails: Type.Optional(Type.Boolean({ description: "Busca o detalhe de cada compra (default true)" })),
    withInvoices: Type.Optional(Type.Boolean({ description: "Busca o overview e o XML das NF-e (default true)" })),
    withCategories: Type.Optional(Type.Boolean({ description: "Roda a passada por categoria (default true)" })),
  }),
  run: (args, ctx) => runSync({ ...ctx, store: ctx.store() }, args),
});
