# PRD — mercadolivre-mcp

Documento de requisitos do produto. Os identificadores `F-n` (funcional),
`NFR-n` (não funcional) e `AR-n` (princípio de arquitetura) são citados nos
comentários do código e nos ADRs para dar rastreabilidade às decisões.

## 1. Visão geral

`mercadolivre-mcp` é um CLI que embute um servidor MCP (stdio) sobre um núcleo
compartilhado. Ele expõe o **histórico de compras de uma conta pessoal do
Mercado Livre (lado comprador)**: compras, produtos, preços cheios e pagos,
descontos e cupons, parcelamento, meio de pagamento, vendedor, entrega e notas
fiscais (NF-e em PDF e XML).

A conta nunca é alterada. A fonte de dados é a mesma superfície web que o
navegador usa (`myaccount.mercadolivre.com.br`), autenticada pelo cookie de
sessão do próprio usuário. Um cache SQLite local torna as perguntas analíticas
instantâneas.

## 2. Problema

O Mercado Livre não oferece API pública do lado comprador: a API oficial
(OAuth) é desenhada para vendedores e o endpoint público de itens responde 403.
O histórico de compras só existe na tela. Conciliar gastos, parcelas e notas
fiscais (especialmente para PJ) exige clicar compra a compra.

## 3. Usuários e casos de uso

- Pessoa física que quer perguntar ao Claude "quanto gastei em 2025 com
  limpeza?", "quantas vezes comprei esse café e a que preço?", "quais parcelas
  ainda estão em aberto?".
- PJ que precisa exportar todas as NF-e de um período para a contabilidade.
- Scripts e automações via CLI (`--json` em todo comando).

## 4. Escopo

### Dentro

- Sessão por cookie do navegador, obtida por login interativo (o usuário digita
  a senha; a ferramenta só persiste a sessão) ou por variável de ambiente.
- Lista paginada de compras com filtros (período, categoria, busca textual).
- Detalhe da compra: breakdown financeiro, parcelas, endereço, vendedor,
  produtos com preço cheio/pago e variações, gancho da NF-e.
- NF-e: metadados, download PDF/XML, exportação em lote, valores por item
  extraídos do XML.
- Cache SQLite com sincronização completa, incremental e reprocessamento local.
- Analytics: gastos por período/vendedor/categoria, recompras, parcelas, meios
  de pagamento.
- Diagnóstico (`doctor`) e escape hatch (`raw_get`) para redescobrir endpoints.

### Fora (v0.1)

- Qualquer escrita na conta. Mercado Pago (sessão separada). Lado vendedor.
- Resources MCP, notificações de progresso, devoluções e avaliações.
- Outros países além de `MLB` (domínios e idioma diferentes).

## 5. Requisitos funcionais

| ID | Requisito |
|---|---|
| F-1 | `auth_status`: diz se a sessão é válida, nickname, id do usuário e expiração mais próxima; instrui o re-login quando inválida |
| F-2 | `login` (CLI): abre navegador headed; o usuário autentica; a sessão é salva com permissão 0600 |
| F-3 | `list_purchases`: lista compras **agrupadas por `purchase_id`**, com filtros de período, categoria, busca e paginação; cache por padrão |
| F-4 | `get_purchase`: detalhe completo de uma compra (financeiro, parcelas, entrega, vendedor, produtos, NF-e) |
| F-5 | `search_purchases`: busca textual no cache (FTS) ou ao vivo |
| F-6 | `list_categories`: categorias aceitas pelo filtro |
| F-7 | `list_products`: produtos comprados com preço pago, unitário, origem do preço, quantidade e variações |
| F-8 | `product_history`: recompras de um produto e evolução de preço |
| F-9 | `spending_summary`: gastos por mês/ano/vendedor/categoria |
| F-10 | `list_installments`: compras parceladas com estimativa rotulada de parcelas restantes |
| F-11 | `list_payment_methods`: meios de pagamento usados e totais |
| F-12 | `get_invoice`: metadados e links da NF-e de um pedido |
| F-13 | `download_invoice` / `export_invoices`: NF-e em PDF/XML, só dentro do diretório configurado |
| F-14 | `sync`: sincronização `incremental` (padrão), `full` e `reparse` (sem rede), com relatório |
| F-15 | `doctor`: valida sessão e cada endpoint, dizendo qual quebrou |
| F-16 | `raw_get`: GET autenticado em hosts permitidos, saída capada, para redescoberta |
| F-17 | Todo tool tem um comando CLI equivalente com `--json` |

## 6. Requisitos não funcionais

| ID | Requisito |
|---|---|
| NFR-1 | Cold start baixo: o servidor MCP não carrega o CLI e vice-versa |
| NFR-2 | Rate limit serial: 1 requisição por vez, intervalo mínimo configurável, jitter, backoff em 403/429 |
| NFR-3 | `stdout` é exclusivo do JSON-RPC; todo log vai para `stderr` |
| NFR-4 | Cookies nunca aparecem em log, erro ou saída de tool |
| NFR-5 | `session.json` e `cache.sqlite` têm permissão 0600 (contêm dados pessoais) |
| NFR-6 | Falha de validação ou de rede vira tool error (`isError`), nunca crash do processo |
| NFR-7 | Parsers testados contra fixtures reais anonimizados versionados |
| NFR-8 | Nenhum dado pessoal no repositório: ids, títulos, endereço, cartão e vendedor são reescritos deterministicamente |
| NFR-9 | Sessão ausente ou expirada produz mensagem acionável (como fazer o login de novo) |
| NFR-10 | Nenhum arquivo de lógica passa de ~400 linhas |

## 7. Princípios de arquitetura

| ID | Princípio |
|---|---|
| AR-1 | Camadas: transporte (MCP/CLI) → tools → domínio (parsers, sync) → infraestrutura (HTTP, sessão, SQLite) |
| AR-2 | O SDK do MCP fica confinado ao adapter `src/mcp/server.ts` |
| AR-3 | TypeBox é a fonte única de verdade: tipos, validação e JSON Schema saem do mesmo objeto |
| AR-4 | Contexto injetado (`Ctx`), sem singletons; `fetch`, relógio, `sleep` e `random` são injetáveis |
| AR-5 | Parsers são funções puras sobre o JSON dos bricks; a rede nunca entra neles |
| AR-6 | O cache SQLite é a superfície de consulta; a rede só entra via `sync` ou quando pedido explicitamente |
| AR-7 | Dinheiro é inteiro em centavos dentro do sistema; reais só na borda da tool |
| AR-8 | `purchase_id` é a chave de agregação; `order_id` é um produto; financeiro gravado uma vez por compra |
| AR-9 | Configuração só por ambiente, validada fail-fast, agregando todos os problemas |
| AR-10 | O par `(packId, orderId)` sempre vem do mesmo item da lista; par cruzado é erro detectado |

## 8. Riscos

- A superfície é interna e pode mudar sem aviso → `doctor`, fixtures versionados e `docs/REDISCOVERY.md`.
- Anti-bot pode rejeitar requisições fora do navegador → `fetch` injetável permite um adapter via navegador.
- Sessão expira sem aviso → detecção por redirecionamento/HTML de login e mensagem de re-login.

## Apêndice A — Variáveis de ambiente

Ver [CONFIGURATION.md](CONFIGURATION.md).

## Apêndice B — Inventário de tools

Ver [TOOLS.md](TOOLS.md) (gerado a partir do registry).
