# ADR-0007 — `purchase_id` como chave; pedido é um produto

- **Status:** Aceito
- **Contexto:** medido na conta real: uma compra de 10 pedidos aparece como 10
  `list_item`, com 3 pacotes e 3 envios; o financeiro do detalhe é da compra inteira e
  idêntico em qualquer pedido; o detalhe lista só parte dos produtos em compras grandes.

## Decisão

Agregar tudo por `purchase_id`; gravar o financeiro uma vez por compra; tratar
`order_id` como um produto com quantidade; exigir que `packId` e `orderId` venham do
mesmo item da lista (par cruzado é página de erro). O inventário de produtos vem da
lista; os preços vêm das linhas do detalhe (totais de linha) casadas por item id,
item id + quantidade, título normalizado e âncora do pedido consultado; o que sobrar
sem preço vem da NF-e, em colunas separadas (valor bruto).

## Consequências

- Somas por compra batem com o que o usuário pagou; contar pedidos inflaria ~3×.
- `paidPrice` é opcional por design; `priceSource` explicita a origem.
