import { Type } from "@sinclair/typebox";
import type { DateFilterValue } from "../mercadolivre/api/purchases.js";
import { centsToNumber } from "../mercadolivre/parser/rich.js";
import { dateFilterRange } from "../cache/queries.js";
import type { PurchaseRow, Store } from "../cache/repo.js";
import { compactObject, defineTool } from "./define.js";
import { dateFilterField } from "./purchases.js";

// Analytics over the cache (F-9, F-10, F-11). Totals use the ticket total
// (what left the pocket, after discounts and coupons). Cancelled purchases
// are excluded unless asked for. The installment schedule is an ESTIMATE:
// the site does not expose it, so charges are assumed monthly from the
// payment date.

const rangeFields = {
  dateFilter: dateFilterField,
  from: Type.Optional(Type.String({ description: "Data da compra >= YYYY-MM-DD" })),
  to: Type.Optional(Type.String({ description: "Data da compra <= YYYY-MM-DD" })),
  includeCancelled: Type.Optional(Type.Boolean({ description: "Inclui compras canceladas (default false)" })),
};

type RangeArgs = { dateFilter?: string; from?: string; to?: string; includeCancelled?: boolean };

const INSTALLMENT_NOTE =
  "Estimativa: o Mercado Livre não expõe o cronograma real das parcelas. As cobranças são assumidas mensais " +
  "a partir da data do pagamento (ou da compra); confira as datas reais na fatura do cartão.";

function purchasesInRange(store: Store, args: RangeArgs, now: Date) {
  const window = dateFilterRange(args.dateFilter as DateFilterValue | undefined, now);
  const rows = store.query.purchases({
    from: args.from ?? window.from,
    to: args.to ?? window.to,
    includeCancelled: args.includeCancelled ?? false,
    limit: 100_000,
  });
  const products = store.query.productsByPurchase(rows.map((row) => row.purchase_id));
  const units = new Map(
    rows.map((row) => [
      row.purchase_id,
      (products.get(row.purchase_id) ?? []).reduce((sum, product) => sum + product.quantity, 0),
    ]),
  );
  return { rows, units };
}

type Group = { total: number; purchases: number; products: number };

export const spendingSummary = defineTool({
  name: "spending_summary",
  description:
    "Resumo de gastos a partir do cache local, sem rede: total pago, descontos, cupons, frete, quantidade de " +
    "compras e produtos e ticket médio, agrupados por mês (default), ano, vendedor, categoria ou nada. Aceita " +
    "uma janela de tempo (dateFilter) ou datas from/to. Compras canceladas ficam de fora, a menos que " +
    "includeCancelled=true. Valores em reais.",
  readOnly: true,
  input: Type.Object({
    ...rangeFields,
    groupBy: Type.Optional(
      Type.Union(
        [Type.Literal("month"), Type.Literal("year"), Type.Literal("seller"), Type.Literal("category"), Type.Literal("none")],
        { description: "month (default), year, seller, category ou none" },
      ),
    ),
  }),
  run: (args, ctx) => {
    const store = ctx.store();
    const { rows, units } = purchasesInRange(store, args, ctx.now());
    const priced = rows.filter((row) => row.total_cents !== null);
    const sum = (pick: (row: PurchaseRow) => number | null) =>
      priced.reduce((total, row) => total + (pick(row) ?? 0), 0);
    const groupBy = args.groupBy ?? "month";

    const groups = new Map<string, Group>();
    const add = (key: string, row: PurchaseRow) => {
      const group = groups.get(key) ?? { total: 0, purchases: 0, products: 0 };
      group.total += row.total_cents ?? 0;
      group.purchases += 1;
      group.products += units.get(row.purchase_id) ?? 0;
      groups.set(key, group);
    };
    let note: string | undefined;
    if (groupBy === "category") {
      const categories = store.query.categoriesByPurchase(priced.map((row) => row.purchase_id));
      for (const row of priced) {
        const list = categories.get(row.purchase_id) ?? ["(sem categoria)"];
        if (list.length > 1) {
          note = "Algumas compras pertencem a mais de uma categoria; o total delas conta em cada uma.";
        }
        for (const category of list) add(category, row);
      }
    } else {
      for (const row of priced) {
        const date = row.purchase_date ?? "";
        const key =
          groupBy === "month" ? date.slice(0, 7) || "?"
          : groupBy === "year" ? date.slice(0, 4) || "?"
          : groupBy === "seller" ? (row.seller_name ?? "(sem vendedor)")
          : "all";
        add(key, row);
      }
    }

    const list = [...groups.entries()].map(([key, group]) => ({
      key,
      total: centsToNumber(group.total),
      purchases: group.purchases,
      products: group.products,
    }));
    if (groupBy === "month" || groupBy === "year") list.sort((a, b) => b.key.localeCompare(a.key));
    if (groupBy === "seller" || groupBy === "category") list.sort((a, b) => b.total - a.total);

    const totalSpent = sum((row) => row.total_cents);
    const interest = sum((row) => row.interest_cents);
    return compactObject({
      groupBy,
      totalSpent: centsToNumber(totalSpent),
      totalDiscounts: centsToNumber(Math.abs(sum((row) => row.discount_cents))),
      totalCoupons: centsToNumber(Math.abs(sum((row) => row.coupons_cents))),
      totalShipping: centsToNumber(sum((row) => row.shipping_cents)),
      totalInterest: interest > 0 ? centsToNumber(interest) : undefined,
      purchaseCount: priced.length,
      productCount: priced.reduce((total, row) => total + (units.get(row.purchase_id) ?? 0), 0),
      averageTicket: priced.length > 0 ? centsToNumber(totalSpent / priced.length) : 0,
      withoutTotal: rows.length - priced.length,
      groups: list,
      note,
    });
  },
});

/** Full months elapsed between an ISO date and `now` (UTC). */
function monthsBetween(startIso: string, now: Date): number {
  const start = new Date(`${startIso}T00:00:00Z`);
  let months =
    (now.getUTCFullYear() - start.getUTCFullYear()) * 12 + (now.getUTCMonth() - start.getUTCMonth());
  if (now.getUTCDate() < start.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

function addMonths(iso: string, months: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

export const listInstallments = defineTool({
  name: "list_installments",
  description:
    "Compras parceladas, a partir do cache local e sem rede: quantidade e valor da parcela, cartão, data do " +
    "pagamento e uma ESTIMATIVA de quantas parcelas ainda faltam e quando cai a última (o site não expõe o " +
    "cronograma real). monthlyCommitment soma as parcelas em aberto. onlyMultiple=false lista toda compra paga. " +
    "Valores em reais.",
  readOnly: true,
  input: Type.Object({
    ...rangeFields,
    onlyMultiple: Type.Optional(Type.Boolean({ description: "Só compras com 2 ou mais parcelas (default true)" })),
  }),
  run: (args, ctx) => {
    const { rows } = purchasesInRange(ctx.store(), args, ctx.now());
    const minimum = args.onlyMultiple === false ? 1 : 2;
    const purchases = rows
      .filter((row) => row.installments !== null && row.installment_cents !== null && row.installments >= minimum)
      .map((row) => {
        const installments = row.installments as number;
        const installmentCents = row.installment_cents as number;
        const start = row.payment_date ?? row.purchase_date;
        const paid = start ? Math.min(installments, monthsBetween(start, ctx.now()) + 1) : undefined;
        const remaining = paid === undefined ? undefined : installments - paid;
        return compactObject({
          purchaseId: row.purchase_id,
          date: row.purchase_date ?? undefined,
          installments,
          installmentValue: centsToNumber(installmentCents),
          totalPaid: centsToNumber(installments * installmentCents),
          method: row.pay_method ?? undefined,
          cardLast4: row.card_last4 ?? undefined,
          paymentDate: row.payment_date ?? undefined,
          estimatedPaidInstallments: paid,
          estimatedRemaining: remaining,
          estimatedEndDate: start ? addMonths(start, installments - 1) : undefined,
          estimatedRemainingAmount:
            remaining === undefined ? undefined : centsToNumber(remaining * installmentCents),
        });
      });
    const monthlyCommitment = purchases
      .filter((purchase) => (purchase.estimatedRemaining ?? 0) > 0)
      .reduce((sum, purchase) => sum + purchase.installmentValue, 0);
    return {
      purchases,
      monthlyCommitment: centsToNumber(Math.round(monthlyCommitment * 100)),
      note: INSTALLMENT_NOTE,
    };
  },
});

export const listPaymentMethods = defineTool({
  name: "list_payment_methods",
  description:
    "Meios de pagamento usados nas compras do cache local (bandeira e últimos dígitos do cartão, Pix, boleto, " +
    "saldo em conta), com quantas compras e quanto passou por cada um, do maior para o menor. Sem rede. Valores " +
    "em reais.",
  readOnly: true,
  input: Type.Object(rangeFields),
  run: (args, ctx) => {
    const { rows } = purchasesInRange(ctx.store(), args, ctx.now());
    const groups = new Map<string, { method: string; cardLast4?: string; purchases: number; total: number; installmentPurchases: number }>();
    for (const row of rows) {
      if (!row.pay_method) continue;
      const key = `${row.pay_method}|${row.card_last4 ?? ""}`;
      const group = groups.get(key) ?? {
        method: row.pay_method,
        cardLast4: row.card_last4 ?? undefined,
        purchases: 0,
        total: 0,
        installmentPurchases: 0,
      };
      group.purchases += 1;
      group.total += row.total_cents ?? 0;
      if ((row.installments ?? 1) > 1) group.installmentPurchases += 1;
      groups.set(key, group);
    }
    return {
      methods: [...groups.values()]
        .sort((a, b) => b.total - a.total)
        .map((group) => compactObject({ ...group, total: centsToNumber(group.total) })),
      withoutPayment: rows.filter((row) => !row.pay_method).length,
    };
  },
});
