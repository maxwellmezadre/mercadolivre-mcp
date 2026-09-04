import { describe, expect, test } from "bun:test";
import { parsePaymentInfo, parsePtBrDate } from "../src/meli/parser/dates.js";

const NOW = new Date("2026-09-04T12:00:00Z");

describe("parsePtBrDate", () => {
  test("uses the current year when the label has none", () => {
    expect(parsePtBrDate("27 de agosto", NOW)).toBe("2026-08-27");
  });

  test("keeps an explicit year", () => {
    expect(parsePtBrDate("3 de julho de 2024", NOW)).toBe("2024-07-03");
  });

  test("a month still ahead of today belongs to the previous year", () => {
    expect(parsePtBrDate("20 de dezembro", new Date("2026-01-05T12:00:00Z"))).toBe("2025-12-20");
  });

  test("understands hoje and ontem", () => {
    expect(parsePtBrDate("Hoje", NOW)).toBe("2026-09-04");
    expect(parsePtBrDate("Ontem", NOW)).toBe("2026-09-03");
  });

  test("finds the date inside a longer sentence, accents optional", () => {
    expect(parsePtBrDate("Chegou no dia 29 de agosto   . Enviado por FULL", NOW)).toBe("2026-08-29");
    expect(parsePtBrDate("1º de marco", NOW)).toBe("2026-03-01");
  });

  test("returns undefined when there is no date", () => {
    expect(parsePtBrDate("A caminho", NOW)).toBeUndefined();
    expect(parsePtBrDate("", NOW)).toBeUndefined();
  });
});

describe("parsePaymentInfo", () => {
  test("extracts the payment date and the Mercado Pago payment id", () => {
    expect(parsePaymentInfo("22 de agosto. Pagamento número 175120955530", NOW)).toEqual({
      paymentDate: "2026-08-22",
      paymentId: "175120955530",
    });
  });

  test("tolerates a missing id", () => {
    expect(parsePaymentInfo("22 de agosto", NOW)).toEqual({ paymentDate: "2026-08-22" });
  });
});
