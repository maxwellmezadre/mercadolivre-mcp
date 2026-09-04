#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { collect } from "../src/meli/parser/bricks.js";
import { detailBrickStack, extractNordicCtx, listRootBrick } from "../src/meli/parser/nordic.js";
import { stripAccents } from "../src/meli/parser/rich.js";
import type { Brick, NordicCtx } from "../src/meli/types.js";

// Turns raw captures (task/captures, private) into fixtures fit for a public
// repository (NFR-8). Deterministic: the same salt maps the same id or word to
// the same stand-in, so purchase/pack/order relationships survive. Amounts,
// dates, quantities and UI labels are untouched, so parser invariants hold.
//
// Usage: bun run scripts/anonymize-fixture.ts <captureDir> <outDir> <name...>

export type Anonymizer = {
  /** Words from these strings (product titles) get pseudonyms. */
  learnTitles(titles: string[]): void;
  text(input: string): string;
  json<T>(input: T): T;
  /** Raw ids/words/secrets still present in `output` (empty = clean). */
  leaks(output: string): string[];
};

// Function words, UI labels, attribute names and units that must survive.
const STOPWORDS = new Set(
  `com sem para por uma umas uns dos das nas nos pelo pela ate mais menos muito pouco
   ser esta este essa esse isso aqui ali cada todo toda todos todas outro outra
   cor tamanho tipo embalagem voltagem fragrancia modelo marca capacidade material
   quantidade unidade unidades produto produtos compra compras pacote pacotes total
   frete desconto descontos cupom cupons vista entregue caminho cancelado cancelada
   chegou chega dia dias enviado enviada full mercado livre loja lojas oficial
   ver comprar novamente detalhe detalhes pagamento numero parcela parcelas reais
   centavos preco precos gratis kit kits par pares cores acabamento
   correia ferragens litro litros metro metros peca pecas jogo conjunto caixa
   hoje ontem amanha janeiro fevereiro marco abril maio junho julho agosto setembro
   outubro novembro dezembro nota fiscal baixar pdf xml enviar mensagem avaliar
   devolver devolucao ajuda opiniao esperam sua seu seus suas voce nao sim`
    .split(/\s+/)
    .filter(Boolean),
);

const WORD = /[A-Za-zÀ-ÖØ-öø-ÿ]{3,}/g;
const LONG_DIGITS = /(?<!\d)\d{9,}(?!\d)/g;
const CARD = /(\*{2,}\s*)(\d{3,4})(?!\d)/g;
const NONCE = /nonce="[^"]*"/g;
const URL_RE = /https?:\/\/[^\s"'<>\\]+/g;
const TRACKING_PARAMS = new Set([
  "sid", "pdp_filters", "tracking_id", "polycard_client", "wid", "source", "search_layout",
  "position", "type", "matt_tool", "matt_word", "reco_backend", "reco_client", "reco_item_pos",
  "reco_backend_type", "reco_id", "c_id", "c_element_order", "c_campaign", "c_uid", "origin",
]);
const CONSONANTS = "bcdfghjklmnprstvz";
const VOWELS = "aeiou";

function hashHex(salt: string, value: string): string {
  return new Bun.CryptoHasher("sha256").update(`${salt}:${value}`).digest("hex");
}

function digitsFrom(hex: string, length: number): string {
  let out = "";
  for (let i = 0; out.length < length; i++) {
    out += String(Number.parseInt(hex[i % hex.length] as string, 16) % 10);
  }
  return out;
}

function pseudoWord(hex: string, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    const byte = Number.parseInt(hex.slice((i * 2) % 62, ((i * 2) % 62) + 2), 16);
    out += i % 2 === 0 ? CONSONANTS[byte % CONSONANTS.length] : VOWELS[byte % VOWELS.length];
  }
  return out;
}

function applyCase(template: string, word: string): string {
  if (template === template.toUpperCase()) return word.toUpperCase();
  const first = template[0] as string;
  if (first === first.toUpperCase()) return `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`;
  return word;
}

const normalizeWord = (word: string): string => stripAccents(word).toLowerCase();

function cleanUrl(raw: string): string {
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    const query = url.searchParams.toString();
    return `${url.origin}${url.pathname}${query ? `?${query}` : ""}`;
  } catch {
    return raw;
  }
}

const SHIPPING_LINE = "Rua Exemplo, 123";
const SHIPPING_CITY = "Cidade Exemplo, Estado.";

type Rich = { accessibility?: string; rich?: unknown[] };

function rewriteRich(value: unknown, text: string): unknown {
  if (!value || typeof value !== "object") return value;
  const rich = value as Rich;
  return {
    ...rich,
    accessibility: text,
    ...(rich.rich ? { rich: [{ type: "text", value: { text } }] } : {}),
  };
}

function isShippingRow(node: Record<string, unknown>): boolean {
  const asset = node.asset as { data?: { id?: unknown } } | undefined;
  return typeof asset?.data?.id === "string" && asset.data.id.includes("shipping");
}

export function createAnonymizer(opts: { salt: string; secrets?: string[] }): Anonymizer {
  const words = new Map<string, string>();
  const rawIds = new Set<string>();
  const mappedIds = new Set<string>();
  const secrets = (opts.secrets ?? []).filter(Boolean);

  const mapId = (value: string): string => {
    rawIds.add(value);
    const mapped = value.slice(0, 4) + digitsFrom(hashHex(opts.salt, value), value.length - 4);
    mappedIds.add(mapped);
    return mapped;
  };

  function text(input: string): string {
    let out = input;
    for (const secret of secrets) out = out.split(secret).join("REDACTED");
    out = out.replace(URL_RE, cleanUrl);
    out = out.replace(NONCE, 'nonce="fixture"');
    out = out.replace(CARD, (_, stars: string, digits: string) =>
      `${stars}${digitsFrom(hashHex(opts.salt, `card:${digits}`), digits.length)}`,
    );
    out = out.replace(LONG_DIGITS, mapId);
    out = out.replace(WORD, (word) => {
      const pseudo = words.get(normalizeWord(word));
      return pseudo ? applyCase(word, pseudo) : word;
    });
    return out;
  }

  function json<T>(input: T): T {
    const visit = (node: unknown): unknown => {
      if (typeof node === "string") return text(node);
      if (Array.isArray(node)) return node.map(visit);
      if (node && typeof node === "object") {
        const source = { ...(node as Record<string, unknown>) };
        if (isShippingRow(source)) {
          source.title = rewriteRich(source.title, SHIPPING_LINE);
          if (Array.isArray(source.secondary_title)) {
            source.secondary_title = source.secondary_title.map((entry) =>
              rewriteRich(entry, SHIPPING_CITY),
            );
          }
        }
        return Object.fromEntries(
          Object.entries(source).map(([key, value]) => [key, visit(value)]),
        );
      }
      return node;
    };
    return visit(input) as T;
  }

  return {
    learnTitles(titles) {
      for (const title of titles) {
        for (const word of title.match(WORD) ?? []) {
          const key = normalizeWord(word);
          if (STOPWORDS.has(key) || words.has(key)) continue;
          words.set(key, pseudoWord(hashHex(opts.salt, `word:${key}`), key.length));
        }
      }
    },
    text,
    json,
    leaks(output) {
      const found = new Set<string>();
      for (const id of rawIds) if (output.includes(id)) found.add(id);
      for (const run of output.match(LONG_DIGITS) ?? []) if (!mappedIds.has(run)) found.add(run);
      const present = new Set((output.match(WORD) ?? []).map(normalizeWord));
      for (const key of words.keys()) if (present.has(key)) found.add(key);
      for (const secret of secrets) if (output.includes(secret)) found.add(secret);
      return [...found];
    },
  };
}

const KEEP_PAGE_PROPS = ["floxResponse", "floxPreloadedState", "errorType", "httpStatus", "title"];
const DROP_KEYS = new Set(["tracking", "tracks", "melidata", "embeddedData", "analytics", "track"]);

function dropKeys(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(dropKeys);
  if (node && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node as Record<string, unknown>)
        .filter(([key]) => !DROP_KEYS.has(key))
        .map(([key, value]) => [key, dropKeys(value)]),
    );
  }
  return node;
}

/** Keeps only the subtrees the parsers read; everything else may carry PII. */
export function prune(ctx: unknown): NordicCtx {
  const pageProps = ((ctx as NordicCtx | undefined)?.appProps?.pageProps ?? {}) as Record<
    string,
    unknown
  >;
  const kept: Record<string, unknown> = {};
  for (const key of KEEP_PAGE_PROPS) {
    if (pageProps[key] !== undefined) kept[key] = dropKeys(pageProps[key]);
  }
  return { appProps: { pageProps: kept } };
}

/** Minimal page around the context, keeping the nonce and trailing-js traps of spec §5.1. */
export function wrapAsPage(ctx: unknown): string {
  return (
    '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Minhas compras</title>' +
    '<script id="__NORDIC_CORE_CTX__" nonce="fixture">_n.ctx.c={"siteId":"MLB","platform":"ml"}</script>' +
    `<script id="__NORDIC_RENDERING_CTX__" nonce="fixture">_n.ctx.r=${JSON.stringify(ctx)};` +
    '_n.ctx.r.__fixture=new Set(["anonymized"]);</script></head>' +
    '<body><div id="root-app">{}</div></body></html>'
  );
}

/** Strings that name products, from every brick shape we know. */
function titleStrings(ctx: NordicCtx): string[] {
  const out: string[] = [];
  const bricks: Brick[] = [];
  try {
    bricks.push(...Object.values(detailBrickStack(ctx)));
  } catch {
    // list page: no brick stack
  }
  try {
    const root = listRootBrick(ctx);
    for (const type of ["list_item", "row_with_ellipsis", "context_with_ellipsis"]) {
      bricks.push(...collect(root, type));
    }
  } catch {
    // detail page: no list root
  }
  for (const brick of bricks) {
    const data = (brick.data ?? {}) as Record<string, unknown>;
    for (const key of ["info", "title"]) {
      const text = (data[key] as { accessibility?: string } | undefined)?.accessibility;
      if (text) out.push(text);
    }
    const alt =
      (data.asset as { data?: { alt?: string } } | undefined)?.data?.alt ??
      (data.image as { alt?: string } | undefined)?.alt;
    if (alt) out.push(alt);
    const url =
      (data.link as { event?: { data?: { url?: string } } } | undefined)?.event?.data?.url ??
      (data.event as { data?: { url?: string } } | undefined)?.data?.url;
    if (url) {
      out.push(url.replace(/https?:\/\/[^/]+/, "").replace(/\?.*$/, "").replace(/[-_/]/g, " "));
    }
  }
  return out;
}

if (import.meta.main) {
  const [captureDir, outDir, ...names] = process.argv.slice(2);
  if (!captureDir || !outDir || names.length === 0) {
    console.error("Usage: bun run scripts/anonymize-fixture.ts <captureDir> <outDir> <name...>");
    process.exit(1);
  }
  const saltFile = join(captureDir, "..", "anonymize.salt");
  if (!existsSync(saltFile)) writeFileSync(saltFile, crypto.randomUUID(), { mode: 0o600 });
  const secretsFile = join(captureDir, "..", "anonymize.secrets");
  const secrets = existsSync(secretsFile)
    ? readFileSync(secretsFile, "utf8").split("\n").map((line) => line.trim()).filter(Boolean)
    : [];
  const anonymizer = createAnonymizer({ salt: readFileSync(saltFile, "utf8").trim(), secrets });

  // Learn product words from EVERY capture so stand-ins are consistent across fixtures.
  const index = JSON.parse(readFileSync(join(captureDir, "index.json"), "utf8")) as Array<{
    name: string;
    kind: string;
  }>;
  for (const entry of index) {
    const path = join(captureDir, entry.name);
    if (!existsSync(path)) continue;
    const body = readFileSync(path, "utf8");
    try {
      if (entry.kind === "html") anonymizer.learnTitles(titleStrings(extractNordicCtx(body)));
      if (entry.kind === "json" && entry.name.startsWith("invoices-overview")) {
        const overview = JSON.parse(body) as { invoices?: Array<{ items?: Array<{ name?: string }> }> };
        anonymizer.learnTitles(
          overview.invoices?.flatMap((invoice) => invoice.items?.map((item) => item.name ?? "") ?? []) ?? [],
        );
      }
      if (entry.name.endsWith(".xml")) {
        anonymizer.learnTitles([...body.matchAll(/<xProd>([^<]+)<\/xProd>/g)].map((match) => match[1] as string));
      }
    } catch (error) {
      console.error(`skip ${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  mkdirSync(outDir, { recursive: true });
  for (const name of names) {
    const body = readFileSync(join(captureDir, name), "utf8");
    let output: string;
    if (name.endsWith(".html")) output = wrapAsPage(anonymizer.json(prune(extractNordicCtx(body))));
    else if (name.endsWith(".json")) output = JSON.stringify(anonymizer.json(JSON.parse(body)), null, 2);
    else output = anonymizer.text(body);
    const leaks = anonymizer.leaks(output);
    if (leaks.length > 0) {
      console.error(`LEAK in ${name}: ${leaks.slice(0, 10).join(", ")}${leaks.length > 10 ? "..." : ""}`);
      process.exitCode = 1;
      continue;
    }
    writeFileSync(join(outDir, name), output);
    console.error(`${name}: ${body.length} -> ${output.length} bytes`);
  }
}
