import { describe, expect, it } from "vitest";
import { useFakeApi } from "../support/fake-api.js";
import { inventoryItem, inventoryLot, stock } from "../support/fixtures.js";
import { useTomu } from "../support/tomu-client.js";

const api = useFakeApi();
const tomu = useTomu();

describe("tomu_inventory", () => {
  it("groups lots under their stock and calls out film expiring soon", async () => {
    const expiring = inventoryItem({ id: "inv-trix", filmStockId: "stock-trix", manufacturer: "Kodak", stockName: "Tri-X 400", expirationDate: "2026-12-31" });
    api.answer("GET", "/inventory/summary", {
      data: { items: [inventoryItem(), inventoryItem({ id: "inv-hp5-120", format: "120", quantity: 5 }), expiring], expiringSoon: [expiring] },
    });

    const reply = await tomu.call("tomu_inventory");

    expect(reply).toContain("## Film Inventory (3 items across 2 stocks)");
    expect(reply).toContain("    - 10 rolls 35mm");
    expect(reply).toContain("    - 5 rolls 120");
    expect(reply).toContain("### Expiring Soon");
    expect(reply).toMatch(/Tri-X 400: 10 rolls 35mm, expires 2026-12-31/);
  });

  it("says when a search finds nothing", async () => {
    api.answer("GET", "/inventory/summary", { data: { items: [inventoryItem()], expiringSoon: [] } });
    expect(await tomu.call("tomu_inventory", { query: "portra" })).toContain('No film matching "portra" found.');
  });
});

describe("tomu_add_inventory", () => {
  it("adds rolls of a stock it already knows, with fridge and 35mm as defaults", async () => {
    api.answer("GET", "/film-stocks", { data: [stock()] }).answer("POST", "/inventory", { data: {} });

    const reply = await tomu.call("tomu_add_inventory", { film: "HP5 Plus", quantity: 5 });

    expect(api.sent("POST", "/inventory")).toEqual({
      filmStockId: "stock-hp5",
      format: "35mm",
      form: "factory_roll",
      storageLocation: "fridge",
      quantity: 5,
    });
    expect(reply).toMatch(/^Added 5 roll\(s\) of \*\*.*HP5 Plus\*\* \(35mm, ISO 400\)\.$/);
  });

  // Loose matching used to file "Verichrome Pan" under "Kodak Technical Pan",
  // one shared word being enough. Stock resolution is strict for that reason.
  it("does not file a new film under a near-namesake", async () => {
    api.answer("GET", "/film-stocks", { data: [stock({ id: "stock-techpan", manufacturer: "Kodak", name: "Technical Pan", iso: 25 })] });

    const reply = await tomu.call("tomu_add_inventory", { film: "Verichrome Pan", quantity: 2 });

    expect(reply).toMatch(/^Film stock "Verichrome Pan" not found\. To create it, also provide: manufacturer, iso/);
    expect(api.wasSent("POST", "/inventory")).toBe(false);
  });

  it("creates the stock when told what it is", async () => {
    api
      .answer("GET", "/film-stocks", { data: [] })
      .answer("POST", "/film-stocks", { data: stock({ id: "stock-vp", manufacturer: "Kodak", name: "Verichrome Pan", iso: 125 }) })
      .answer("POST", "/inventory", { data: {} });

    const reply = await tomu.call("tomu_add_inventory", { film: "Verichrome Pan", manufacturer: "Kodak", iso: 125, format: "120", quantity: 2 });

    expect(api.sent("POST", "/film-stocks")).toEqual({ manufacturer: "Kodak", name: "Verichrome Pan", iso: 125, type: "bw" });
    expect(api.sent("POST", "/inventory")).toMatchObject({ filmStockId: "stock-vp", format: "120" });
    expect(reply).toContain("Created this film stock — it was new.");
  });

  it("measures a bulk roll in feet, and needs the length", async () => {
    expect(await tomu.call("tomu_add_inventory", { film: "HP5 Plus", form: "bulk_roll" })).toBe("Bulk rolls require `lengthFt` (e.g. 100).");

    api.answer("GET", "/film-stocks", { data: [stock()] }).answer("POST", "/inventory", { data: {} });
    await tomu.call("tomu_add_inventory", { film: "HP5 Plus", form: "bulk_roll", lengthFt: 100 });
    expect(api.sent("POST", "/inventory")).toMatchObject({ originalLengthFt: 100, remainingLengthFt: 100 });
  });
});

describe("tomu_edit_inventory", () => {
  it("coerces a month-precision expiry before patching", async () => {
    api
      .answer("GET", "/inventory", { data: [inventoryLot()] })
      .answer("PATCH", "/inventory/inv-hp5", { data: inventoryLot({ expirationDate: "2027-12-31" }) });

    const reply = await tomu.call("tomu_edit_inventory", { film: "hp5", expirationDate: "2027.12" });

    expect(api.sent("PATCH", "/inventory/inv-hp5")).toEqual({ expirationDate: "2027-12-31" });
    expect(reply).toMatch(/^Updated \*\*.*HP5 Plus\*\* \(35mm, 10 rolls 35mm\): expirationDate=2027-12-31\.$/);
  });

  // The API once returned a bare row with no stock fields; formatting the
  // confirmation threw, and the tool reported failure for a patch that had landed.
  it("confirms a successful patch even when the API returns a bare row", async () => {
    api
      .answer("GET", "/inventory", { data: [inventoryLot()] })
      .answer("PATCH", "/inventory/inv-hp5", { data: { id: "inv-hp5", quantity: 8 } });

    const reply = await tomu.call("tomu_edit_inventory", { film: "hp5", quantity: 8 });

    expect(reply).toMatch(/^Updated \*\*.*HP5 Plus\*\* \(35mm, 8 rolls 35mm\): quantity=8\.$/);
  });

  it("refuses a call that changes nothing, before looking anything up", async () => {
    expect(await tomu.call("tomu_edit_inventory", { film: "hp5" })).toMatch(/^Nothing to change/);
    expect(api.requests).toHaveLength(0);
  });
});

describe("tomu_delete_inventory", () => {
  it("will not delete a lot that still holds film without confirmation", async () => {
    api.answer("GET", "/inventory", { data: [inventoryLot({ displayId: "R001", quantity: 3 })] });

    const reply = await tomu.call("tomu_delete_inventory", { displayId: "R001" });

    expect(reply).toMatch(/^That lot still has film in it: \[R001\].*Re-run with confirm: true/);
    expect(api.requests.some((r) => r.method === "DELETE")).toBe(false);
  });

  it("deletes an empty lot outright", async () => {
    api
      .answer("GET", "/inventory", { data: [inventoryLot({ displayId: "R001", quantity: 0 })] })
      .answer("DELETE", "/inventory/inv-hp5", null, 204);

    expect(await tomu.call("tomu_delete_inventory", { displayId: "R001" })).toMatch(/^Deleted \[R001\]/);
  });

  it("treats a bulk roll with footage left as holding film", async () => {
    api.answer("GET", "/inventory", { data: [inventoryLot({ displayId: "B001", form: "bulk_roll", quantity: 0, remainingLengthFt: "12" })] });
    expect(await tomu.call("tomu_delete_inventory", { displayId: "B001" })).toMatch(/^That lot still has film in it/);
  });
});

describe("tomu_set_stock_aliases", () => {
  const ncs = stock({ id: "stock-ncs", manufacturer: "NoColorStudio", name: "no.5", iso: 100, aliases: ["NCS"] });

  it("merges new aliases with the existing ones, without duplicates", async () => {
    api.answer("GET", "/film-stocks", { data: [ncs] }).answer("PATCH", "/film-stocks/stock-ncs", { data: {} });

    const reply = await tomu.call("tomu_set_stock_aliases", { film: "NoColorStudio no.5", aliases: ["NCS#5", "NCS"] });

    expect(api.sent("PATCH", "/film-stocks/stock-ncs")).toEqual({ aliases: ["NCS", "NCS#5"] });
    expect(reply).toMatch(/aliases now: NCS, NCS#5$/);
  });

  it("replaces the list in set mode", async () => {
    api.answer("GET", "/film-stocks", { data: [ncs] }).answer("PATCH", "/film-stocks/stock-ncs", { data: {} });
    await tomu.call("tomu_set_stock_aliases", { film: "NoColorStudio no.5", aliases: ["NCS5"], mode: "set" });
    expect(api.sent("PATCH", "/film-stocks/stock-ncs")).toEqual({ aliases: ["NCS5"] });
  });
});
