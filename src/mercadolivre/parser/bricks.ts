import type { Brick, BrickStack } from "../types.js";

// Generic helpers over the brick tree/map (spec §6.1). Brick ids are
// `{ui_type}_{hex}` with a random suffix per render, so matching is always by
// ui_type — and when a stack entry lacks `ui_type`, the id prefix stands in.

const ID_SUFFIX = /_[0-9a-f]{6,}$/;

export function uiTypeOf(brick: Brick): string | undefined {
  if (brick.ui_type) return brick.ui_type;
  return brick.id ? brick.id.replace(ID_SUFFIX, "") : undefined;
}

/** Depth-first, parent before children. */
export function* walk(root: Brick): Generator<Brick> {
  yield root;
  for (const child of root.bricks ?? []) yield* walk(child);
}

export function collect(root: Brick, uiType: string): Brick[] {
  return [...walk(root)].filter((brick) => uiTypeOf(brick) === uiType);
}

export function collectFromStack(stack: BrickStack, uiType: string): Brick[] {
  return Object.values(stack).filter(
    (brick) => brick !== null && typeof brick === "object" && uiTypeOf(brick) === uiType,
  );
}
