import { describe, expect, it } from "vitest";
import { useFakeApi } from "../support/fake-api.js";
import { camera, inventoryItem, lens } from "../support/fixtures.js";
import { useTomu } from "../support/tomu-client.js";

const api = useFakeApi();
const tomu = useTomu();

describe("tomu_summary", () => {
  it("totals film by form, counts distinct stocks and gear, and flags expiring film", async () => {
    const trix = inventoryItem({ id: "inv-trix", filmStockId: "stock-trix", quantity: 3 });
    api
      .answer("GET", "/inventory/summary", {
        data: {
          items: [
            inventoryItem({ quantity: 5 }),
            trix,
            inventoryItem({ id: "inv-arista", filmStockId: "stock-arista", form: "sheet", format: "4x5", quantity: 10 }),
            inventoryItem({ id: "inv-bulk", form: "bulk_roll", quantity: 0, remainingLengthFt: "50" }),
          ],
          expiringSoon: [trix],
        },
      })
      .answer("GET", "/cameras", { data: [camera(), camera({ id: "cam-m7" })] })
      .answer("GET", "/lenses", { data: [lens()] });

    expect(await tomu.call("tomu_summary")).toBe(
      [
        "## Tomu Dashboard\n",
        "- **8** factory rolls + **50ft** bulk + **10** sheets across **3** stocks",
        "- **2** cameras, **1** lenses",
        "- **1** item(s) expiring within 6 months",
      ].join("\n"),
    );
  });

  it("says there is no inventory rather than showing zeros", async () => {
    api
      .answer("GET", "/inventory/summary", { data: { items: [], expiringSoon: [] } })
      .answer("GET", "/cameras", { data: [] })
      .answer("GET", "/lenses", { data: [] });

    expect(await tomu.call("tomu_summary")).toContain("- No inventory across **0** stocks");
  });
});
