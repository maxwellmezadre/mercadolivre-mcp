import { describe, expect, test } from "bun:test";
import { extractNordicCtx } from "../src/meli/parser/nordic.js";
import { createAnonymizer, prune, pruneJson, wrapAsPage } from "../scripts/anonymize-fixture.js";

// The anonymizer is the gate that lets real captures into a public repo
// (NFR-8). Deterministic so relationships between ids survive; amounts are
// untouched so the money invariants in the parser tests still hold.

const PURCHASE = "2000014741074853";
const anon = () => createAnonymizer({ salt: "test-salt" });

describe("numeric ids", () => {
  test("rewrites long digit runs deterministically, keeping length and the first four digits", () => {
    const a = anon();
    const mapped = a.text(PURCHASE);

    expect(mapped).not.toBe(PURCHASE);
    expect(mapped).toHaveLength(PURCHASE.length);
    expect(mapped.startsWith("2000")).toBe(true);
    expect(a.text(PURCHASE)).toBe(mapped);
    expect(createAnonymizer({ salt: "other" }).text(PURCHASE)).not.toBe(mapped);
  });

  test("keeps relationships: the same id maps the same everywhere, short numbers stay", () => {
    const a = anon();
    const out = a.text(`purchase ${PURCHASE} pack ${PURCHASE} item MLB2086446083 qty 14 total 486,96`);
    const mapped = a.text(PURCHASE);

    expect(out).toBe(`purchase ${mapped} pack ${mapped} item MLB${a.text("2086446083")} qty 14 total 486,96`);
    expect(out).not.toContain("2086446083");
  });
});

describe("title words", () => {
  test("replaces learned product words with pronounceable stand-ins, preserving case and structure", () => {
    const a = anon();
    a.learnTitles(["Azeite De Oliva Extra Virgem Gallo 500 Ml"]);

    const out = a.text("Azeite De Oliva Extra Virgem Gallo 500 Ml Uma unidade. Tipo de embalagem Vidro");

    for (const word of ["Azeite", "Oliva", "Extra", "Virgem", "Gallo"]) expect(out).not.toContain(word);
    expect(out).toMatch(/^[A-Z][a-z]+ De [A-Z][a-z]+ [A-Z][a-z]+ [A-Z][a-z]+ [A-Z][a-z]+ 500 Ml Uma unidade\. Tipo de embalagem Vidro$/);
    expect(a.text("AZEITE azeite Azeíte")).toMatch(/^([A-Z]+) ([a-z]+) ([A-Z][a-z]+)$/);
  });

  test("never touches ui labels, attribute names or stopwords", () => {
    const a = anon();
    a.learnTitles(["Cor Preto Kit Bolsa Produtos Total Entregue"]);

    expect(a.text("Cor: Preto")).toMatch(/^Cor: [A-Z][a-z]+$/);
    expect(a.text("Produtos (14) Total Entregue Kit")).toBe("Produtos (14) Total Entregue Kit");
  });
});

describe("fixed rewrites", () => {
  test("masks card digits, strips tracking query params, neutralises the nonce", () => {
    const a = anon();

    expect(a.text("Mastercard **** 4321")).toMatch(/^Mastercard \*\*\*\* \d{4}$/);
    expect(a.text("Mastercard **** 4321")).not.toBe("Mastercard **** 4321");
    expect(a.text("https://www.mercadolivre.com.br/MLB-2086446083-azeite-_JM?sid=abc123&pdp_filters=x#polycard")).toBe(
      `https://www.mercadolivre.com.br/MLB-${a.text("2086446083")}-azeite-_JM`,
    );
    expect(a.text(`https://myaccount.mercadolivre.com.br/my_purchases/${PURCHASE}/status?packId=${PURCHASE}&orderId=${PURCHASE}`)).toBe(
      `https://myaccount.mercadolivre.com.br/my_purchases/${a.text(PURCHASE)}/status?packId=${a.text(PURCHASE)}&orderId=${a.text(PURCHASE)}`,
    );
    expect(a.text('<script id="x" nonce="AnwUZD9abc">')).toBe('<script id="x" nonce="fixture">');
  });

  test("replaces explicit secrets", () => {
    const a = createAnonymizer({ salt: "s", secrets: ["Maxwell Mezadre", "max@example.com"] });

    expect(a.text("Olá, Maxwell Mezadre <max@example.com>")).toBe("Olá, REDACTED <REDACTED>");
  });
});

describe("json", () => {
  test("walks every string and rewrites the shipping address row", () => {
    const a = anon();
    const out = a.json({
      ui_type: "detail_information_row",
      data: {
        asset: { data: { id: "buflo_congrats_information_shipping" } },
        title: { accessibility: "Rua Real 19", rich: [{ type: "text", value: { text: "Rua Real 19" } }] },
        secondary_title: [{ accessibility: "Rolante, Rio Grande do Sul.", rich: [{ type: "text", value: { text: "Rolante, Rio Grande do Sul." } }] }],
        context: { purchase_id: PURCHASE },
      },
    }) as { data: { title: { accessibility: string; rich: Array<{ value: { text: string } }> }; secondary_title: Array<{ accessibility: string }>; context: { purchase_id: string } } };

    expect(out.data.title.accessibility).toBe("Rua Exemplo, 123");
    expect(out.data.title.rich[0]?.value.text).toBe("Rua Exemplo, 123");
    expect(out.data.secondary_title[0]?.accessibility).toBe("Cidade Exemplo, Estado.");
    expect(out.data.context.purchase_id).toBe(a.text(PURCHASE));
  });
});

describe("prune", () => {
  test("keeps only the flox subtrees and drops tracking keys at any depth", () => {
    const out = prune({
      appProps: {
        pageProps: {
          floxResponse: { data: { brick: { id: "main", tracking: { x: 1 }, bricks: [{ id: "b", melidata: {} }] } }, tracking: { tracks: [] } },
          floxPreloadedState: { "@meli/web/flox/FLOX_STATE": { brickStack: {} } },
          embeddedData: { user_id: 1 },
          errorType: undefined,
          httpStatus: 200,
        },
        other: 1,
      },
      settings: {},
    }) as { appProps: { pageProps: Record<string, unknown> } };

    expect(Object.keys(out)).toEqual(["appProps"]);
    expect(Object.keys(out.appProps.pageProps).sort()).toEqual(["floxPreloadedState", "floxResponse", "httpStatus"]);
    expect(JSON.stringify(out)).not.toMatch(/tracking|melidata|embeddedData/);
  });
});

describe("leaks and wrapping", () => {
  test("leaks() lists raw ids and words that survived; clean output reports none", () => {
    const a = anon();
    a.learnTitles(["Azeite Gallo"]);
    const raw = `Azeite Gallo ${PURCHASE}`;
    const out = a.text(raw);

    expect(a.leaks(out)).toEqual([]);
    expect(a.leaks(raw).sort()).toEqual([PURCHASE, "azeite", "gallo"].sort());
  });

  test("wrapAsPage produces a page the real extractor parses, with nonce and trailing js", () => {
    const html = wrapAsPage({ appProps: { pageProps: { floxResponse: { data: { brick: { id: "main_1", ui_type: "main" } } } } } });

    expect(html).toContain('nonce="fixture"');
    expect(html).toContain("new Set(");
    expect(extractNordicCtx(html).appProps?.pageProps?.floxResponse?.data?.brick?.ui_type).toBe("main");
  });
});

describe("xml", () => {
  test("replaces the buyer block, the issuer identity, free text and the signature, then anonymizes the rest", () => {
    const a = createAnonymizer({ salt: "s" });
    a.learnTitles(["Cafe Torrado Chocolate"]);
    const xml = `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe35260703007331021220550020225654171000000001">
<emit><CNPJ>03007331021220</CNPJ><xNome>Loja Real LTDA</xNome><xFant>Loja Real</xFant><enderEmit><xLgr>Rua Da Loja</xLgr><nro>10</nro><xMun>Cidade</xMun></enderEmit></emit>
<dest><CPF>12345678901</CPF><xNome>Fulano De Tal</xNome><enderDest><xLgr>Rua Do Comprador</xLgr><nro>19</nro><xBairro>Centro</xBairro><CEP>95690000</CEP></enderDest><email>fulano@example.com</email></dest>
<det nItem="1"><prod><cProd>ABC</cProd><xProd>Cafe Torrado Chocolate</xProd><qCom>1.0000</qCom><vUnCom>33.30</vUnCom><vProd>33.30</vProd></prod></det>
<infAdic><infCpl>Pedido de Fulano De Tal, entregar na Rua Do Comprador</infCpl></infAdic></infNFe>
<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo>abc</SignedInfo></Signature></NFe>
<protNFe><infProt><chNFe>35260703007331021220550020225654171000000001</chNFe><nProt>135260000000001</nProt></infProt></protNFe></nfeProc>`;

    const out = a.xml(xml);

    for (const raw of ["Fulano", "Comprador", "12345678901", "fulano@example.com", "Loja Real", "Rua Da Loja", "Cafe", "Torrado", "SignedInfo", "35260703007331021220550020225654171000000001"]) {
      expect(out).not.toContain(raw);
    }
    expect(out).toContain("<dest><CPF>000.000.000-00</CPF><xNome>Destinatario Exemplo</xNome>");
    expect(out).toContain("<xNome>Emitente Exemplo LTDA</xNome>");
    expect(out).toContain("<infCpl>Texto livre removido</infCpl>");
    expect(out).toMatch(/<vUnCom>33\.30<\/vUnCom><vProd>33\.30<\/vProd>/);
    expect(out).toMatch(/<chNFe>3526\d{40}<\/chNFe>/);
    expect(a.leaks(out)).toEqual([]);
  });
});

describe("json numbers and envelopes", () => {
  test("numeric ids stay numbers but are mapped, and keys carrying ids are mapped too", () => {
    const a = createAnonymizer({ salt: "s" });
    const out = a.json({ seller_id: 480265022, qty: 14, price: 486.96, "2000014741074853": { user_id: 1081309642 } }) as Record<string, unknown>;

    expect(out.seller_id).not.toBe(480265022);
    expect(typeof out.seller_id).toBe("number");
    expect(String(out.seller_id)).toMatch(/^4802\d{5}$/);
    expect(out.qty).toBe(14);
    expect(out.price).toBe(486.96);
    const [key] = Object.keys(out).filter((k) => /^\d+$/.test(k));
    expect(key).toMatch(/^2000\d{12}$/);
    expect(key).not.toBe("2000014741074853");
    expect(a.leaks(JSON.stringify(out))).toEqual([]);
  });

  test("pruneJson keeps only the brick of a list_items envelope", () => {
    const out = pruneJson({ type: "register_and_render", data: { brick: { id: "main", tracking: { x: 1 } } }, tracking: { tracks: [1] } }) as Record<string, unknown>;

    expect(Object.keys(out).sort()).toEqual(["data", "type"]);
    expect(JSON.stringify(out)).not.toContain("tracking");
  });
});

describe("keys and ui words (captured 2026-09-05)", () => {
  test("object keys only get the id mapping, never the word mapping", () => {
    const a = createAnonymizer({ salt: "s" });
    a.learnTitles(["Web Flox State Meli"]);
    const out = a.json({ "@meli/web/flox/FLOX_STATE": { brickStack: {} }, title: "Web Flox" }) as Record<string, unknown>;

    expect(Object.keys(out)).toEqual(["@meli/web/flox/FLOX_STATE", "title"]);
    expect(out.title).not.toBe("Web Flox");
  });

  test("words of the list subtitles survive even when a title uses them", () => {
    const a = createAnonymizer({ salt: "s" });
    a.learnTitles(["Kit contém 8 unidades últimos meses ano"]);

    expect(a.text('3 compras contêm "x" nos últimos 3 meses deste ano')).toBe('3 compras contêm "x" nos últimos 3 meses deste ano');
  });
});
