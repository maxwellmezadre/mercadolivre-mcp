# Fixtures

Páginas reais da conta, capturadas em 2026-09-05 e **anonimizadas** por
`scripts/anonymize-fixture.ts` (ver [ADR-0008](../../docs/adr/0008-anonymized-real-fixtures.md)).
Valores, quantidades e datas são os reais; ids, palavras de produto, vendedor,
endereço e cartão são substitutos determinísticos. `test/fixtures.test.ts` lê tudo aqui.

| Arquivo | O que é |
| --- | --- |
| `list-page-1.html` | página 1 da lista: 29 pedidos, 10 compras, 17 pacotes, "68 compras", 7 páginas |
| `list-page-4.html` | página 4: agrupadores com ano ("3 de julho de 2025") |
| `json-search.json` | endpoint JSON com `searchValue` (3 compras) |
| `json-date-3m.json` | endpoint JSON com `filterDate=3M` (15 compras, 2 páginas) |
| `detail-10-orders.html` | compra de 10 pedidos / 14 unidades: 486,96 − 70,45 − 31,11 = 385,40; 5 linhas; loja oficial |
| `detail-3-orders.html` | 3 pedidos: 646,94 cheio, 376,69 pago |
| `detail-single.html` | 1 pedido: 619,90 − 277,00 − 20,00 = 322,90 |
| `detail-installments.html` | 10 parcelas de 53,55 sobre total 535,49 (arredondamento) |
| `detail-split-payment.html` | dois pagamentos (1x 59,89 + 5x 14,38) e linhas de pagamento no ticket |
| `detail-pickup.html` | retirada no vendedor + reembolso |
| `detail-pix.html` | pagamento por Pix |
| `detail-cancelled.html` | compra cancelada com reembolso integral |
| `invoices-overview-single.json` / `-batch.json` | overview de NF-e para 1 e 10 pedidos |
| `nfe.xml` | NF-e 4.00 (bloco do comprador, emitente e assinatura substituídos) |

Regras da anonimização: ids ≥ 9 dígitos reescritos por hash (tamanho e 4 primeiros
dígitos mantidos, relações preservadas); palavras de título → pseudo-palavras; rótulos
de UI intocados; endereço/cartão/nonce/parâmetros de rastreio reescritos; chaves de
`tracking`/`melidata`/`embeddedData` podadas; no XML, `<dest>`, identidade do `<emit>`,
`<infCpl>` e `<Signature>` substituídos. O script falha se sobrar qualquer dado original.
Capturas cruas nunca entram no repositório.
