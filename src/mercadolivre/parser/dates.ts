import { stripAccents } from "./rich.js";

// Portuguese date labels (spec §6.2). The list groups purchases under labels
// like "27 de agosto" (current year, no year shown) or "3 de julho de 2024".
// The clock is injected (AR-4); UTC fields keep the result machine-independent.

const MONTHS = [
  "janeiro", "fevereiro", "marco", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const DATE = /(\d{1,2})[º°]?\s+de\s+([a-z]+)(?:\s+de\s+(\d{4}))?/;
const PAYMENT_ID = /pagamento numero\s+(\d+)/;

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Finds a date inside `label`; without a year, assumes the most recent past one. */
export function parsePtBrDate(label: string, now: Date): string | undefined {
  const text = stripAccents(label).toLowerCase();
  if (!text.trim()) return undefined;
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const day = now.getUTCDate();

  if (/\bhoje\b/.test(text)) return iso(year, month, day);
  if (/\bontem\b/.test(text)) {
    const yesterday = new Date(Date.UTC(year, month - 1, day - 1));
    return iso(yesterday.getUTCFullYear(), yesterday.getUTCMonth() + 1, yesterday.getUTCDate());
  }

  const match = DATE.exec(text);
  if (!match) return undefined;
  const parsedDay = Number(match[1]);
  const parsedMonth = MONTHS.indexOf(match[2] as string) + 1;
  if (parsedMonth === 0 || parsedDay < 1 || parsedDay > 31) return undefined;

  let parsedYear = match[3] ? Number(match[3]) : year;
  // A label without a year that points past today belongs to last year.
  const ahead = parsedMonth > month || (parsedMonth === month && parsedDay > day);
  if (!match[3] && ahead) parsedYear -= 1;
  return iso(parsedYear, parsedMonth, parsedDay);
}

/** "22 de agosto. Pagamento número 175120955530" -> date + Mercado Pago id. */
export function parsePaymentInfo(
  text: string,
  now: Date,
): { paymentDate?: string; paymentId?: string } {
  const paymentDate = parsePtBrDate(text, now);
  const paymentId = PAYMENT_ID.exec(stripAccents(text).toLowerCase())?.[1];
  return {
    ...(paymentDate ? { paymentDate } : {}),
    ...(paymentId ? { paymentId } : {}),
  };
}
