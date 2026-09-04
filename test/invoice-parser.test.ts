import { describe, expect, test } from "bun:test";
import { ParseError } from "../src/core/errors.js";
import { parseInvoiceOverview, parseInvoiceXml } from "../src/meli/parser/invoice.js";

// Shapes from spec §4.4 (overview JSON) and §4.5 (NF-e 4.00 XML).

const DOWNLOAD = "https://www.mercadolivre.com.br/emissor/omni/api/invoices-download/sale";

const OVERVIEW = JSON.stringify({
  invoices: [
    {
      invoice_date: "2026-08-28T01:19:41Z",
      invoice_source: "internal",
      transaction_type: "sale",
      items: [{ id: "MLB2086446083", name: "Azeite De Oliva Extra Virgem Gallo 500 Ml" }],
      actions: [
        {
          id: "x", text: "Baixar nota fiscal", command: "expand",
          sub_actions: [
            { id: "download_pdf", text: "Baixar em PDF", command: "download", url: `${DOWNLOAD}/2000018152227106/pdf` },
            { id: "download_xml", text: "Baixar em XML", command: "download", url: `${DOWNLOAD}/2000018152227106/xml` },
          ],
        },
      ],
    },
    {
      invoice_date: "2026-07-17T18:40:24Z",
      invoice_source: "internal",
      transaction_type: "sale",
      items: [{ id: "MLB1111111111", name: "Cafe Torrado" }],
      actions: [{ sub_actions: [{ id: "download_pdf", command: "download", url: `${DOWNLOAD}/2000018152227110/pdf` }] }],
    },
    { invoice_date: "2026-01-01T00:00:00Z", items: [], actions: [] },
  ],
  platform: { siteId: "MLB", countryId: "BR" },
  locale: "pt-BR",
});

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe><infNFe Id="NFe35260703007331021220550020225654171000000001" versao="4.00">
    <ide><nNF>22565417</nNF><dhEmi>2026-07-17T15:40:24-03:00</dhEmi></ide>
    <emit><CNPJ>03007331021220</CNPJ><xNome>Loja Exemplo LTDA</xNome></emit>
    <det nItem="1"><prod><cProd>ABC</cProd><xProd>Cafe Torrado e Moido Chocolate T</xProd><NCM>09012100</NCM><CFOP>6106</CFOP>
      <qCom>1.0000</qCom><vUnCom>33.30000000</vUnCom><vProd>33.30</vProd><vDesc>0.00</vDesc></prod></det>
    <det nItem="2"><prod><cProd>DEF</cProd><xProd>Filtro de Papel</xProd><NCM>48239090</NCM><CFOP>6106</CFOP>
      <qCom>2.0000</qCom><vUnCom>4.5000</vUnCom><vProd>9.00</vProd><vDesc>1.00</vDesc></prod></det>
    <total><ICMSTot><vProd>42.30</vProd><vDesc>1.00</vDesc><vNF>41.30</vNF></ICMSTot></total>
  </infNFe></NFe>
  <protNFe><infProt><chNFe>35260703007331021220550020225654171000000001</chNFe></infProt></protNFe>
</nfeProc>`;

describe("parseInvoiceOverview", () => {
  test("derives the order id from the download url and keeps metadata and links", () => {
    const invoices = parseInvoiceOverview(OVERVIEW);

    expect(invoices).toHaveLength(2);
    expect(invoices[0]).toEqual({
      orderId: "2000018152227106",
      invoiceDate: "2026-08-28T01:19:41Z",
      source: "internal",
      transactionType: "sale",
      items: [{ id: "MLB2086446083", name: "Azeite De Oliva Extra Virgem Gallo 500 Ml" }],
      pdfUrl: `${DOWNLOAD}/2000018152227106/pdf`,
      xmlUrl: `${DOWNLOAD}/2000018152227106/xml`,
    });
    expect(invoices[1]).toMatchObject({ orderId: "2000018152227110", pdfUrl: `${DOWNLOAD}/2000018152227110/pdf` });
    expect(invoices[1]!.xmlUrl).toBeUndefined();
  });

  test("rejects bodies that are not the overview envelope", () => {
    expect(() => parseInvoiceOverview("<html>")).toThrow(ParseError);
    expect(() => parseInvoiceOverview('{"foo":1}')).toThrow(ParseError);
  });
});

describe("parseInvoiceXml", () => {
  test("reads header, totals and every item in cents", () => {
    const invoice = parseInvoiceXml(XML);

    expect(invoice).toMatchObject({
      accessKey: "35260703007331021220550020225654171000000001",
      number: "22565417",
      issuedAt: "2026-07-17T15:40:24-03:00",
      issuerCnpj: "03007331021220",
      issuerName: "Loja Exemplo LTDA",
      totalCents: 4130,
    });
    expect(invoice.items).toEqual([
      { code: "ABC", description: "Cafe Torrado e Moido Chocolate T", quantity: 1, unitCents: 3330, totalCents: 3330, discountCents: 0, ncm: "09012100", cfop: "6106" },
      { code: "DEF", description: "Filtro de Papel", quantity: 2, unitCents: 450, totalCents: 900, discountCents: 100, ncm: "48239090", cfop: "6106" },
    ]);
  });

  test("tolerates namespace prefixes and rejects non-xml", () => {
    const prefixed = XML.replace(/<(\/?)(\w+)/g, "<$1nfe:$2").replace('<nfe:?xml', "<?xml");
    expect(parseInvoiceXml(prefixed).items).toHaveLength(2);
    expect(() => parseInvoiceXml("<!DOCTYPE html><html>")).toThrow(ParseError);
  });
});
