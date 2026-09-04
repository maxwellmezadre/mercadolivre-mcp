# mercadolivre-mcp

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/runtime-Bun%20%E2%89%A51.2-black)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](tsconfig.json)

CLI + servidor MCP que expõe ao Claude (e a scripts) o **histórico de compras da
sua conta do Mercado Livre** — compras, produtos, preços pagos, descontos,
parcelamento, vendedor, entrega e notas fiscais (NF-e em PDF/XML).

Só leitura na conta. A sessão é a do seu navegador (você faz o login; a
ferramenta nunca vê a senha). Os dados ficam num cache SQLite local para
perguntas analíticas instantâneas ("quanto gastei em 2025 com limpeza?").

> Em construção — o roadmap está em [docs/PRD.md](docs/PRD.md).

## Licença

[MIT](LICENSE).
