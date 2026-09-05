# Modelo de dados

## A hierarquia de ids (o ponto mais importante)

A nomenclatura do Mercado Livre engana. O que existe de fato:

```
COMPRA  (purchase_id)   = um checkout. "Compra número N" na tela. CHAVE DE AGREGAÇÃO.
  └─ PACOTE (pack_id)   = agrupamento logístico dentro da compra ("Pacote 1, 2, 3")
       └─ PEDIDO (order_id) = UM PRODUTO. É a unidade da lista e da NF-e.
            └─ ENVIO (shipment_id) = rastreio; compartilhado entre pedidos do mesmo pacote
```

Consequências que o código segue à risca (AR-8, AR-10):

- A lista de compras mostra **um item por pedido**; a mesma compra aparece várias
  vezes. Tudo é agrupado por `purchase_id` — contar itens como compras infla ~3×.
- A página de detalhe exige `purchaseId`, `packId` **e** `orderId`, e o par
  `packId`/`orderId` precisa vir do **mesmo item** da lista. Par cruzado devolve uma
  página de erro com HTTP 200 (`errorType: "error"`), que o parser transforma em
  `UpstreamError`.
- O financeiro do detalhe (`ticket_row`, parcelas, endereço, vendedor) descreve a
  **compra inteira** e é idêntico em qualquer pedido dela: gravado uma única vez.
- Numa compra de um só produto, `purchase_id == pack_id == order_id`. Não presuma
  isso nas demais.

## Modelo canônico (`src/meli/types.ts`)

Todo id é `string`. Todo valor é inteiro em **centavos** dentro do sistema (AR-7); as
tools convertem para reais na saída.

| Tipo | Origem | Campos-chave |
| --- | --- | --- |
| `PurchaseListItem` | um `list_item` da lista | ids, `purchaseDate` (do agrupador de data), `status`, `deliveryHeadline`, `isFull`, `productTitle`, `quantity`, `itemId`, urls |
| `PurchaseGroup` | itens agrupados por compra | `orderCount`, `totalUnits`, `packIds`, `detailRef` (par válido), `products` |
| `DetailPage` | página de detalhe | `money`, `payment`, `shipping` (endereço), `seller`, `products` (linhas), `queriedProductTitle`, `invoiceOrderIds`, `warnings` |
| `MoneyBreakdown` | `ticket_row` por rótulo | `productsCents`, `discountCents` (negativo), `couponsCents` (negativo), `shippingCents`, `totalCents`, `interestCents`, `itemCount`, `extras` |
| `Payment` | `detail_information_row` | `installments`, `installmentCents`, `totalCents`, `method`, `cardLast4`, `paymentDate`, `paymentId` |
| `DetailProduct` | `row_with_ellipsis` | `title`, `quantity`, `listCents`, `paidCents` (**totais da linha**), `variations`, `itemId` |
| `MergedProduct` | lista × detalhe | tudo acima + `unitCents`, `priceSource` |
| `InvoiceOverview` | `invoices-overview` | `orderId` (da URL de download), data, itens, `pdfUrl`, `xmlUrl` |
| `InvoiceXml` | XML da NF-e | chave de acesso, número, emissão, CNPJ, `totalCents`, itens com `unitCents`/`totalCents` |

## Identidades de preço

Verificadas contra a conta real e testadas:

```
Σ linhas pagas                 = produtos + desconto          (desconto é negativo)
total                          = Σ linhas pagas + cupons + frete   (à vista)
total (N parcelas)             = N × parcela;  juros = total − (produtos + desconto + cupons + frete)
Σ quantidades dos pedidos      = itemCount ("Produtos (N)")
```

- Os preços das linhas do detalhe são **totais da linha** (já multiplicados pela
  quantidade); `unitPrice = paidPrice / quantity`.
- O detalhe **não** lista todas as linhas em compras grandes (medido: 4 de 7 e 5 de 10).
  O inventário completo vem da lista; o preço das linhas ausentes vem da NF-e.
- A NF-e traz o valor **bruto** (`vUnCom`, `vProd`), antes dos descontos e cupons da
  compra. Por isso ela fica em colunas próprias (`invoice_unit_cents`,
  `invoice_line_cents`) e só vira `paidPrice` quando não há outro valor
  (`priceSource: "invoice"`).
- Quando a identidade falha, o parser registra um `warning` em vez de corrigir
  silenciosamente; `doctor` e `sync` expõem os avisos.

## `priceSource`

| Valor | Significado |
| --- | --- |
| `detail` | linha do detalhe da compra: preço efetivamente pago (após desconto do item, antes de cupons) |
| `invoice` | valor bruto da NF-e; a compra não trouxe a linha no detalhe |
| `none` | nenhuma fonte deu valor (sem linha no detalhe e sem NF-e) |

## Schema SQLite (`src/store/db.ts`, versão 1)

- `purchases` — uma linha por compra: ids do primeiro pedido (par válido), data,
  status, vendedor, todos os `*_cents`, `item_count`, parcelas, meio de pagamento,
  endereço, `has_invoice`, `invoice_order_ids`, `detail_fetched_at`, `raw_detail`
  (brickStack para reprocessar sem rede), `warnings`.
- `products` — uma linha por pedido (`order_id` único): título e `title_norm`,
  quantidade, status de entrega, `list_cents`/`paid_cents`/`unit_cents`,
  `price_source`, `invoice_unit_cents`/`invoice_line_cents`, variações (JSON), urls.
- `invoices` — uma linha por pedido com NF-e: metadados do overview + cabeçalho e itens
  do XML.
- `purchase_categories` — N:N compra × categoria (uma compra pode aparecer em várias).
- `products_fts` — FTS5 (`unicode61 remove_diacritics 2`) sobre título e variações,
  reconstruída a cada `sync`.
- `sync_state` — `full_sync_completed_at`, `last_sync_at`, `total_pages`, `total_label`,
  `categories`, `categories_synced_at`, `parser_version`.

Arquivo e journal com permissão `0600`; contém endereço, últimos dígitos do cartão e
histórico de consumo.

## Estimativas

`list_installments` calcula parcelas pagas/restantes assumindo cobranças mensais a
partir de `paymentDate` (ou da data da compra). O site não expõe o cronograma real; a
saída leva `note` e prefixo `estimated*` para deixar isso claro.

## Ajustes medidos na conta real (2026-09-05)

- `MoneyBreakdown.refundCents`: valor devolvido ("Reembolso"), fora da identidade.
- `DetailPage.payments`: todas as linhas de pagamento (pagamento dividido tem duas);
  `payment` é a primeira. No cache: coluna `payments` (JSON) além das colunas do
  primeiro pagamento.
- `ShippingAddress.pickup`: retirada no vendedor no lugar do endereço.
- Tolerância da conferência de pagamentos: um centavo por parcela ("N parcelas de X"
  vem arredondado), além dos 2 centavos da identidade do ticket.
- Cancelamento: qualquer status contendo "cancel" ("Compra cancelada", "Você cancelou a
  compra"). Finais (não refeitos pelo `sync`): entregue, cancelado, reclamação
  resolvida, reembolsado.
- `DetailPage.isEmpty`: página sem `ticket`, rubricas e produtos; `get_purchase` a trata
  como par `packId`/`orderId` inválido.
