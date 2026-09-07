# Tools

> Gerado por `bun run docs:tools` a partir de `src/tools/registry.ts`. Não edite à mão.

O servidor expõe **18 tools**. Com `MERCADOLIVRE_READ_ONLY=1` as 5 que escrevem algo (sessão, cache, arquivo) não são registradas. A conta do Mercado Livre é somente leitura em todas elas. Valores em reais; datas `YYYY-MM-DD`.

| Tool | Escreve | O que faz |
| --- | --- | --- |
| [`auth_status`](#authstatus) | não | Diz se há uma sessão do Mercado Livre salva e o que ela cobre (origem, apelido, id do usuário, quantidade e va... |
| [`login`](#login) | sim | Abre o navegador padrão para o usuário entrar na conta do Mercado Livre e guarda a sessão cifrada (a senha nun... |
| [`doctor`](#doctor) | não | Diagnostica a instalação de ponta a ponta: sessão, página da lista de compras, endpoint JSON da lista, página ... |
| [`sync`](#sync) | sim | Sincroniza o cache local com o histórico de compras do Mercado Livre (a conta é só lida). mode=incremental (de... |
| [`list_purchases`](#listpurchases) | não | Lista as compras do Mercado Livre agrupadas por compra (uma compra = um checkout; dentro dela, um produto por ... |
| [`get_purchase`](#getpurchase) | não | Detalhe completo de uma compra: breakdown financeiro (produtos, desconto, cupons, frete, total), parcelas e ca... |
| [`search_purchases`](#searchpurchases) | não | Busca no histórico de compras por título, marca ou variação do produto. scope=cache (default) é uma busca text... |
| [`list_categories`](#listcategories) | não | Lista os nomes de categoria aceitos por list_purchases (category) e as janelas de tempo disponíveis. Usa as ca... |
| [`list_products`](#listproducts) | não | Lista os produtos comprados a partir do cache local (rode sync antes), sem rede, com preço pago, preço unitári... |
| [`product_history`](#producthistory) | não | Todas as compras de um produto (por id do item ou texto do título) a partir do cache local, sem rede, da mais ... |
| [`list_installments`](#listinstallments) | não | Compras parceladas, a partir do cache local e sem rede: quantidade e valor da parcela, cartão, data do pagamen... |
| [`list_payment_methods`](#listpaymentmethods) | não | Meios de pagamento usados nas compras do cache local (bandeira e últimos dígitos do cartão, Pix, boleto, saldo... |
| [`get_invoice`](#getinvoice) | não | Metadados da NF-e de um pedido (data da nota, itens, links de PDF e XML), com 1 requisição. Cada pedido é um p... |
| [`download_invoice`](#downloadinvoice) | sim | Baixa a NF-e de um pedido em PDF ou XML para MERCADOLIVRE_EXPORT_DIR (default ~/Downloads/mercadolivre-export)... |
| [`export_invoices`](#exportinvoices) | sim | Baixa todas as NF-e que o cache local conhece num período (rode sync com invoices antes) para MERCADOLIVRE_EXP... |
| [`spending_summary`](#spendingsummary) | não | Resumo de gastos a partir do cache local, sem rede: total pago, descontos, cupons, frete, quantidade de compra... |
| [`export`](#export) | sim | Exporta o cache para um arquivo JSON ou CSV: compras (uma linha por compra, com o financeiro) ou produtos (uma... |
| [`raw_get`](#rawget) | não | GET autenticado num host permitido do Mercado Livre (myaccount.mercadolivre.com.br, www.mercadolivre.com.br), ... |

## `auth_status`

Diz se há uma sessão do Mercado Livre salva e o que ela cobre (origem, apelido, id do usuário, quantidade e validade dos cookies). Não usa a rede por padrão. Com verify=true gasta 1 requisição à página de compras para confirmar que o site ainda aceita a sessão. Comece por aqui quando outra tool reclamar de sessão.

**Escreve em disco/cache:** não

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `verify` | boolean | não | Também faz 1 requisição à página de compras para confirmar que a sessão é aceita |

## `login`

Abre o navegador padrão para o usuário entrar na conta do Mercado Livre e guarda a sessão cifrada (a senha nunca passa por aqui). Bloqueia até a lista de compras carregar, por até 5 minutos. Com from_browser, importa a sessão de um navegador já logado (macOS) em vez de abrir a janela. Prefira o comando de terminal `mercadolivre login` quando o cliente MCP tiver timeout curto. Gasta 1 requisição no fim para confirmar que o site aceita a sessão.

**Escreve em disco/cache:** sim

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `fresh` | boolean | não | Apaga o perfil do navegador de automação antes (login do zero) |
| `from_browser` | `arc` \| `chrome` \| `chromium` \| `brave` \| `edge` | não | Importa os cookies de um navegador já logado (só macOS) em vez de abrir uma janela |

## `doctor`

Diagnostica a instalação de ponta a ponta: sessão, página da lista de compras, endpoint JSON da lista, página de detalhe, identidade financeira, overview das NF-e e cache local. Diz qual camada quebrou quando o Mercado Livre muda alguma coisa; rode antes de reportar um problema. Gasta até 4 requisições.

**Escreve em disco/cache:** não

Sem parâmetros.

## `sync`

Sincroniza o cache local com o histórico de compras do Mercado Livre (a conta é só lida). mode=incremental (default) atualiza as páginas mais novas e as compras não finais; mode=full percorre todas as páginas e categorias (faça uma vez; ~70 compras levam cerca de 3 minutos, a uma requisição por segundo); mode=reparse reprocessa as páginas em cache sem rede. Devolve um relatório com contagens, avisos e erros. Não chame em paralelo com outras tools de rede.

**Escreve em disco/cache:** sim

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `mode` | `incremental` \| `full` \| `reparse` | não | incremental (default), full ou reparse |
| `maxPages` | integer (≥ 1, ≤ 100) | não | Teto de páginas da lista por passada (default 10) |
| `withDetails` | boolean | não | Busca o detalhe de cada compra (default true) |
| `withInvoices` | boolean | não | Busca o overview e o XML das NF-e (default true) |
| `withCategories` | boolean | não | Roda a passada por categoria (default true) |

## `list_purchases`

Lista as compras do Mercado Livre agrupadas por compra (uma compra = um checkout; dentro dela, um produto por pedido), da mais recente para a mais antiga. Lê o cache local por padrão (rode sync antes; enquanto o cache estiver vazio consulta o site, 1 requisição por página; fromCache=false força o site). Filtros: janela de tempo (dateFilter) ou datas from/to, categoria exata (veja list_categories) e busca por texto. Valores em reais e o detailRef que get_purchase precisa.

**Escreve em disco/cache:** não

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `fromCache` | boolean | não | Lê o cache local (default true) |
| `dateFilter` | `ALL` \| `30D` \| `3M` \| `6M` \| `Y` \| `1Y` \| `2Y` \| `3Y` \| `4Y` | não | Janela de tempo: ALL (default), 30D, 3M, 6M, Y (ano corrente) ou 1Y..4Y (anos-calendário: 1Y = ano passado) |
| `from` | string | não | Só no cache: data da compra >= YYYY-MM-DD |
| `to` | string | não | Só no cache: data da compra <= YYYY-MM-DD |
| `category` | string (min 1 chars) | não | Nome exato da categoria, de list_categories |
| `search` | string (min 1 chars) | não | Texto livre: título ou marca do produto |
| `limit` | integer (≥ 1, ≤ 500) | não | Só no cache: máximo de compras (default 50) |
| `offset` | integer (≥ 0) | não | Só no cache: compras a pular (default 0) |
| `page` | integer (≥ 1) | não | Só no site: primeira página a ler (default 1) |
| `maxPages` | integer (≥ 1, ≤ 50) | não | Só no site: páginas consecutivas a ler (default 1) |

## `get_purchase`

Detalhe completo de uma compra: breakdown financeiro (produtos, desconto, cupons, frete, total), parcelas e cartão, endereço de entrega, vendedor, cada produto com preço cheio, pago e unitário e variações, e os metadados da NF-e. Busca a página de detalhe no site (1 requisição, mais 1 para a NF-e). packId e orderId precisam vir do mesmo item da lista (list_purchases devolve um detailRef válido); sem eles a tool procura no cache e depois varre a lista (1 requisição por página).

**Escreve em disco/cache:** não

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `purchaseId` | string (min 1 chars) | sim | Id da compra ('Compra número N') |
| `packId` | string (min 1 chars) | não | Id do pacote, par de orderId |
| `orderId` | string (min 1 chars) | não | Id do pedido, par de packId |
| `includeInvoice` | boolean | não | Busca também os metadados da NF-e (default true) |
| `maxLookupPages` | integer (≥ 1, ≤ 50) | não | Páginas a varrer quando o par não é informado (default 10) |

## `search_purchases`

Busca no histórico de compras por título, marca ou variação do produto. scope=cache (default) é uma busca textual no cache local, sem rede, e diz quais produtos casaram em cada compra; scope=live pergunta ao site (1 requisição, só a primeira página de resultados).

**Escreve em disco/cache:** não

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `query` | string (min 1 chars) | sim | Palavras a procurar |
| `scope` | `cache` \| `live` | não | cache (default) ou live |
| `limit` | integer (≥ 1, ≤ 500) | não | Só no cache: máximo de produtos (default 100) |

## `list_categories`

Lista os nomes de categoria aceitos por list_purchases (category) e as janelas de tempo disponíveis. Usa as categorias salvas pelo último sync, ou o site (1 requisição) quando o cache está vazio. Pode vir vazio: o site não oferece o filtro de categoria para toda conta.

**Escreve em disco/cache:** não

Sem parâmetros.

## `list_products`

Lista os produtos comprados a partir do cache local (rode sync antes), sem rede, com preço pago, preço unitário, quantidade, variações e vendedor. Filtra por período, vendedor, faixa de preço e título. Compras canceladas ficam de fora, a menos que includeCancelled=true. Valores em reais.

**Escreve em disco/cache:** não

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `from` | string | não | Data da compra >= YYYY-MM-DD |
| `to` | string | não | Data da compra <= YYYY-MM-DD |
| `seller` | string (min 1 chars) | não | Nome do vendedor (parcial) ou id do vendedor |
| `minPaid` | number (≥ 0) | não | Valor mínimo pago na linha, em reais |
| `maxPaid` | number (≥ 0) | não | Valor máximo pago na linha, em reais |
| `titleContains` | string (min 1 chars) | não | Texto contido no título do produto |
| `sort` | `date_desc` \| `date_asc` \| `paid_desc` \| `paid_asc` | não | Ordenação (default date_desc) |
| `limit` | integer (≥ 1, ≤ 1000) | não | Máximo de linhas (default 100) |
| `includeCancelled` | boolean | não | Inclui compras canceladas (default false) |

## `product_history`

Todas as compras de um produto (por id do item ou texto do título) a partir do cache local, sem rede, da mais antiga para a mais nova, com a evolução do preço unitário: serve para 'quanto paguei nisso antes?' e perguntas de recompra. Valores em reais.

**Escreve em disco/cache:** não

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `itemId` | string (min 1 chars) | não | Id do item, por exemplo MLB2086446083 |
| `titleContains` | string (min 1 chars) | não | Texto contido no título do produto |

## `list_installments`

Compras parceladas, a partir do cache local e sem rede: quantidade e valor da parcela, cartão, data do pagamento e uma ESTIMATIVA de quantas parcelas ainda faltam e quando cai a última (o site não expõe o cronograma real). monthlyCommitment soma as parcelas em aberto. onlyMultiple=false lista toda compra paga. Valores em reais.

**Escreve em disco/cache:** não

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `dateFilter` | `ALL` \| `30D` \| `3M` \| `6M` \| `Y` \| `1Y` \| `2Y` \| `3Y` \| `4Y` | não | Janela de tempo: ALL (default), 30D, 3M, 6M, Y (ano corrente) ou 1Y..4Y (anos-calendário: 1Y = ano passado) |
| `from` | string | não | Data da compra >= YYYY-MM-DD |
| `to` | string | não | Data da compra <= YYYY-MM-DD |
| `includeCancelled` | boolean | não | Inclui compras canceladas (default false) |
| `onlyMultiple` | boolean | não | Só compras com 2 ou mais parcelas (default true) |

## `list_payment_methods`

Meios de pagamento usados nas compras do cache local (bandeira e últimos dígitos do cartão, Pix, boleto, saldo em conta), com quantas compras e quanto passou por cada um, do maior para o menor. Sem rede. Valores em reais.

**Escreve em disco/cache:** não

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `dateFilter` | `ALL` \| `30D` \| `3M` \| `6M` \| `Y` \| `1Y` \| `2Y` \| `3Y` \| `4Y` | não | Janela de tempo: ALL (default), 30D, 3M, 6M, Y (ano corrente) ou 1Y..4Y (anos-calendário: 1Y = ano passado) |
| `from` | string | não | Data da compra >= YYYY-MM-DD |
| `to` | string | não | Data da compra <= YYYY-MM-DD |
| `includeCancelled` | boolean | não | Inclui compras canceladas (default false) |

## `get_invoice`

Metadados da NF-e de um pedido (data da nota, itens, links de PDF e XML), com 1 requisição. Cada pedido é um produto; get_purchase os lista em invoiceOrderIds. Os links expiram: para salvar o arquivo use download_invoice.

**Escreve em disco/cache:** não

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `orderId` | string (min 1 chars) | sim | Id do pedido (um produto) |

## `download_invoice`

Baixa a NF-e de um pedido em PDF ou XML para MERCADOLIVRE_EXPORT_DIR (default ~/Downloads/mercadolivre-export) e devolve o caminho do arquivo. Gasta 1 requisição. O XML traz o valor unitário exato do produto (vUnCom), bruto, antes dos descontos da compra.

**Escreve em disco/cache:** sim

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `orderId` | string (min 1 chars) | sim | Id do pedido (um produto); veja invoiceOrderIds em get_purchase |
| `format` | `pdf` \| `xml` | sim | pdf ou xml |
| `fileName` | string (min 1 chars) | não | Nome do arquivo dentro do diretório de exportação (default nfe-<orderId>.<formato>) |

## `export_invoices`

Baixa todas as NF-e que o cache local conhece num período (rode sync com invoices antes) para MERCADOLIVRE_EXPORT_DIR, em PDF, XML ou os dois. Gasta 1 requisição por arquivo. Arquivos que já existem são pulados, a menos que overwrite=true; compras canceladas ficam de fora, a menos que includeCancelled=true. Útil para contabilidade.

**Escreve em disco/cache:** sim

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `dateFilter` | `ALL` \| `30D` \| `3M` \| `6M` \| `Y` \| `1Y` \| `2Y` \| `3Y` \| `4Y` | não | Janela de tempo: ALL (default), 30D, 3M, 6M, Y (ano corrente) ou 1Y..4Y (anos-calendário: 1Y = ano passado) |
| `from` | string | não | Data da compra >= YYYY-MM-DD |
| `to` | string | não | Data da compra <= YYYY-MM-DD |
| `format` | `pdf` \| `xml` \| `both` | não | pdf, xml ou both (default both) |
| `overwrite` | boolean | não | Baixa de novo por cima dos arquivos existentes (default false) |
| `includeCancelled` | boolean | não | Inclui compras canceladas (default false) |

## `spending_summary`

Resumo de gastos a partir do cache local, sem rede: total pago, descontos, cupons, frete, quantidade de compras e produtos e ticket médio, agrupados por mês (default), ano, vendedor, categoria ou nada. Aceita uma janela de tempo (dateFilter) ou datas from/to. Compras canceladas ficam de fora, a menos que includeCancelled=true. Valores em reais.

**Escreve em disco/cache:** não

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `dateFilter` | `ALL` \| `30D` \| `3M` \| `6M` \| `Y` \| `1Y` \| `2Y` \| `3Y` \| `4Y` | não | Janela de tempo: ALL (default), 30D, 3M, 6M, Y (ano corrente) ou 1Y..4Y (anos-calendário: 1Y = ano passado) |
| `from` | string | não | Data da compra >= YYYY-MM-DD |
| `to` | string | não | Data da compra <= YYYY-MM-DD |
| `includeCancelled` | boolean | não | Inclui compras canceladas (default false) |
| `groupBy` | `month` \| `year` \| `seller` \| `category` \| `none` | não | month (default), year, seller, category ou none |

## `export`

Exporta o cache para um arquivo JSON ou CSV: compras (uma linha por compra, com o financeiro) ou produtos (uma linha por pedido, com preço pago e unitário). Grava somente dentro de MERCADOLIVRE_EXPORT_DIR (default ~/Downloads/mercadolivre-export) e devolve o caminho. Não usa a rede; rode sync antes. Valores em reais, datas YYYY-MM-DD.

**Escreve em disco/cache:** sim

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `format` | `json` \| `csv` | sim | Formato do arquivo |
| `scope` | `purchases` \| `products` | sim | purchases (uma linha por compra) ou products (uma linha por pedido) |
| `dateFilter` | `ALL` \| `30D` \| `3M` \| `6M` \| `Y` \| `1Y` \| `2Y` \| `3Y` \| `4Y` | não | Janela de tempo: ALL (default), 30D, 3M, 6M, Y (ano corrente) ou 1Y..4Y (anos-calendário: 1Y = ano passado) |
| `from` | string | não | Data da compra >= YYYY-MM-DD |
| `to` | string | não | Data da compra <= YYYY-MM-DD |
| `includeCancelled` | boolean | não | Inclui compras canceladas (default false) |
| `filename` | string (min 1 chars) | não | Nome do arquivo, sem diretório (default mercadolivre-<escopo>-<data>.<formato>) |

## `raw_get`

GET autenticado num host permitido do Mercado Livre (myaccount.mercadolivre.com.br, www.mercadolivre.com.br), para redescobrir endpoints quando o site mudar. Só GET, nunca escreve na conta. as=html devolve o texto da página, as=json interpreta um endpoint JSON, as=nordic extrai a árvore de bricks renderizada no servidor e um censo de ui_type. A saída é limitada por maxBytes. Gasta 1 requisição.

**Escreve em disco/cache:** não

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `url` | string | sim | URL absoluta ou caminho (caminhos resolvem contra myaccount.mercadolivre.com.br) |
| `as` | `html` \| `json` \| `nordic` | não | Como ler a resposta (default html) |
| `maxBytes` | integer (≥ 1024, ≤ 1000000) | não | Máximo de caracteres devolvidos em body (default 65536) |
