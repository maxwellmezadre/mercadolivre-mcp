# ADR-0007: Dinheiro em centavos inteiros

## Contexto

A ferramenta soma valores de anos de compras e confere identidades (produtos
mais desconto mais cupons mais frete igual ao total). Ponto flutuante acumula
erro, e o SQLite não tem tipo decimal. O site entrega cada preço como um nó
`price` com `fraction` e `cents` separados, às vezes com separador de milhar
na fração, e a NF-e traz `vUnCom` com quatro casas.

## Decisão

Centavo inteiro em todo o modelo canônico (`src/mercadolivre/types.ts`) e em
todas as colunas `*_cents` do cache. A conversão para decimal acontece só na
borda da tool, com `centsToNumber`. As identidades financeiras são conferidas
em centavos, com tolerância de 2 centavos no ticket e de 1 centavo por parcela
quando o site mostra "N parcelas de X" arredondado.

## Consequências

`SUM()` é exato e as somas por compra batem com o que o usuário pagou. Um valor
que não pôde ser lido vira `null`, nunca zero: um zero silencioso mentiria num
relatório de gastos. `unitPrice` é derivado (pago dividido por quantidade) e
arredondado uma única vez.
