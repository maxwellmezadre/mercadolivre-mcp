# Fixtures

Payloads do site usados pelos testes de parsing.

Os testes de `test/*.test.ts` constroem fixtures sintéticos no formato observado do
site (spec §5–6): nonce no `<script>`, JavaScript depois do JSON, `rich`/`accessibility`,
`list_item_grouper`, `ticket_row` em ordem inversa, `row_with_ellipsis` com totais de
linha, par cruzado como página de erro.

Fixtures **reais anonimizados** (quando presentes) são gerados por
`scripts/anonymize-fixture.ts` a partir das capturas cruas privadas (`task/captures/`,
gitignored), com estas regras:

- ids longos (≥ 9 dígitos: compra, pacote, pedido, envio, pagamento, vendedor, item,
  chave de NF-e, CNPJ) são reescritos por hash determinístico, mantendo tamanho e os 4
  primeiros dígitos, então as relações entre ids sobrevivem;
- palavras dos títulos de produto viram pseudo-palavras pronunciáveis (mesmo tamanho,
  mesma capitalização); rótulos de UI, meses, unidades e nomes de atributo ficam;
- endereço → "Rua Exemplo, 123" / "Cidade Exemplo, Estado."; cartão → últimos dígitos
  mapeados; loja → "Loja oficial " + palavra mapeada; `?sid=` e outros parâmetros de
  rastreio removidos; `nonce` → `fixture`; chaves `tracking`/`melidata`/`embeddedData`
  podadas;
- **valores, quantidades e datas não mudam**, então as identidades financeiras
  continuam verificáveis;
- o script falha se qualquer id, palavra ou segredo original sobrar na saída.

Capturas cruas nunca entram no repositório.
