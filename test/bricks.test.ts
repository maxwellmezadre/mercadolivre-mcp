import { describe, expect, test } from "bun:test";
import { collect, collectFromStack, uiTypeOf, walk } from "../src/meli/parser/bricks.js";
import type { Brick } from "../src/meli/types.js";

const tree: Brick = {
  id: "main_1",
  ui_type: "main",
  bricks: [
    { id: "list_item_grouper_1", ui_type: "list_item_grouper", bricks: [] },
    {
      id: "list_item_container_1",
      ui_type: "list_item_container",
      bricks: [
        { id: "list_item_aa11bb", ui_type: "list_item", bricks: [{ id: "button_1", ui_type: "button" }] },
        { id: "list_item_cc22dd", ui_type: "list_item" },
      ],
    },
  ],
};

describe("walk and collect", () => {
  test("walk yields every brick depth-first, parent before children", () => {
    expect([...walk(tree)].map((brick) => brick.id)).toEqual([
      "main_1",
      "list_item_grouper_1",
      "list_item_container_1",
      "list_item_aa11bb",
      "button_1",
      "list_item_cc22dd",
    ]);
  });

  test("collect filters by ui_type across the whole tree", () => {
    expect(collect(tree, "list_item").map((brick) => brick.id)).toEqual([
      "list_item_aa11bb",
      "list_item_cc22dd",
    ]);
  });
});

describe("uiTypeOf", () => {
  test("prefers ui_type and falls back to the id without its hex suffix", () => {
    expect(uiTypeOf({ id: "x_1", ui_type: "ticket_row" })).toBe("ticket_row");
    expect(uiTypeOf({ id: "row_with_ellipsis_9fa8c5bc28d0" })).toBe("row_with_ellipsis");
    expect(uiTypeOf({ id: "detail_information_row_ab12cd" })).toBe("detail_information_row");
    expect(uiTypeOf({})).toBeUndefined();
  });
});

describe("collectFromStack", () => {
  test("matches by ui_type or by id-derived type on the flat detail map", () => {
    const stack = {
      ticket_row_1a2b3c: { id: "ticket_row_1a2b3c", ui_type: "ticket_row" },
      ticket_row_4d5e6f: { id: "ticket_row_4d5e6f" },
      ticket_1: { id: "ticket_1", ui_type: "ticket" },
    };

    expect(collectFromStack(stack, "ticket_row").map((brick) => brick.id)).toEqual([
      "ticket_row_1a2b3c",
      "ticket_row_4d5e6f",
    ]);
    expect(collectFromStack(stack, "ticket")).toHaveLength(1);
  });
});
