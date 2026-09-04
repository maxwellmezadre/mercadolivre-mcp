import { ParseError, SessionError, UpstreamError } from "../../core/errors.js";
import type { Brick, BrickStack, NordicCtx } from "../types.js";

// Extracts the server-rendered state from a Nordic page (spec §5.1). Three
// real traps shape this code: the script tag carries a dynamic `nonce`, the
// JSON is followed by more JavaScript before `</script>`, and the JSON itself
// holds braces inside strings — so the object is sliced by a balanced-brace
// scanner, never by a regex up to `</script>`.

const OPEN_TAG = /id="__NORDIC_RENDERING_CTX__"[^>]*>\s*_n\.ctx\.r\s*=\s*/;
const FLOX_STATE_KEY = "@meli/web/flox/FLOX_STATE";

/** Slices one JSON value starting at `start`, honouring strings and escapes. */
export function sliceBalancedJson(src: string, start: number): string {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < src.length; i++) {
    const char = src[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === "{" || char === "[") {
      depth += 1;
    } else if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new ParseError("Unbalanced JSON in the Nordic rendering context");
}

/**
 * Parses the rendering context out of a page. A missing context means the
 * login page (or a brand-new layout); an `errorType` inside it means Mercado
 * Livre rendered its own error page with HTTP 200 (spec §4.3).
 */
export function extractNordicCtx(html: string): NordicCtx {
  const match = OPEN_TAG.exec(html);
  if (!match) {
    throw new SessionError(
      "EXPIRED",
      "The page has no Nordic rendering context (login page or new layout).",
    );
  }
  let ctx: NordicCtx;
  try {
    ctx = JSON.parse(sliceBalancedJson(html, match.index + match[0].length));
  } catch (error) {
    if (error instanceof ParseError) throw error;
    throw new ParseError(
      `Nordic rendering context is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const pageProps = ctx.appProps?.pageProps;
  const status = pageProps?.httpStatus;
  if (pageProps?.errorType || (status !== undefined && status >= 400)) {
    throw new UpstreamError(
      status ?? 500,
      `Mercado Livre rendered an error page: ${pageProps?.title ?? pageProps?.errorType ?? "unknown error"}`,
    );
  }
  return ctx;
}

/** Root brick of the purchase list page (a tree). */
export function listRootBrick(ctx: NordicCtx): Brick {
  const brick = ctx.appProps?.pageProps?.floxResponse?.data?.brick;
  if (!brick) {
    throw new ParseError("List page layout changed: floxResponse.data.brick not found");
  }
  return brick;
}

/** Flat brick map of the purchase detail page (spec §4.3, path B). */
export function detailBrickStack(ctx: NordicCtx): BrickStack {
  const stack =
    ctx.appProps?.pageProps?.floxPreloadedState?.[FLOX_STATE_KEY]?.brickStack;
  if (!stack) {
    throw new ParseError("Detail page layout changed: FLOX_STATE.brickStack not found");
  }
  return stack;
}

/** Root brick of the `/api/web/list_items` JSON envelope (spec §4.2). */
export function floxJsonRootBrick(body: string): Brick {
  let envelope: { type?: string; data?: { brick?: Brick } };
  try {
    envelope = JSON.parse(body);
  } catch {
    throw new ParseError("list_items endpoint did not return JSON");
  }
  if (envelope.type !== "register_and_render" || !envelope.data?.brick) {
    throw new ParseError(
      `list_items envelope changed: expected type register_and_render, got ${envelope.type ?? "none"}`,
    );
  }
  return envelope.data.brick;
}
