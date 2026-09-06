import { describe, expect, it } from "vitest";
import {
  bestMatch,
  cleanStockName,
  displayStock,
  fuzzyMatch,
  normalize,
  rankedMatch,
  score,
  strictStockMatch,
  tokens,
} from "../src/matching.js";

interface Stock {
  manufacturer: string;
  name: string;
  iso: number;
}

const stock = (manufacturer: string, name: string, iso: number): Stock => ({ manufacturer, name, iso });

/** The fields every stock lookup in server.ts matches against. */
const stockFields = (s: Stock) => [`${s.manufacturer} ${s.name}`, s.name, s.manufacturer];

const CATALOG: Stock[] = [
  stock("Kodak", "Tri-X 400", 400),
  stock("Kodak", "Technical Pan", 25),
  stock("Kodak", "Portra 400", 400),
  stock("Ilford", "HP5 Plus", 400),
  stock("Ilford", "Delta 100", 100),
  stock("Washi", "S", 50),
  stock("Arista", "EDU Ultra 100", 100),
  stock("Arista", "EDU 400 DX", 400),
];

describe("normalize", () => {
  it("strips punctuation, spacing, and case", () => {
    expect(normalize("Tri-X 400")).toBe("trix400");
    expect(normalize("HP5+")).toBe("hp5");
  });

  it("collapses to empty when nothing alphanumeric survives", () => {
    expect(normalize("—/.")).toBe("");
  });
});

describe("tokens", () => {
  it("splits on any non-alphanumeric run", () => {
    expect(tokens("Kodak Tri-X 400")).toEqual(["kodak", "tri", "x", "400"]);
  });

  it("drops empty segments", () => {
    expect(tokens("  HP5+ / Plus  ")).toEqual(["hp5", "plus"]);
  });
});

describe("fuzzyMatch", () => {
  it("matches on a normalized substring in either direction", () => {
    expect(fuzzyMatch("trix", "Kodak Tri-X 400")).toBe(true);
    expect(fuzzyMatch("Kodak Tri-X 400", "trix")).toBe(true);
  });

  it("rejects a non-overlapping candidate", () => {
    expect(fuzzyMatch("velvia", "Kodak Tri-X 400", "Ilford HP5 Plus")).toBe(false);
  });
});

describe("score", () => {
  it("scores an exact token higher than a substring token", () => {
    expect(score("trix", ["Tri-X 400"])).toBeLessThan(score("tri x", ["Tri-X 400"]));
  });

  it("returns 0 when nothing overlaps", () => {
    expect(score("velvia", stockFields(stock("Ilford", "HP5 Plus", 400)))).toBe(0);
  });

  it("returns 0 for an empty query", () => {
    expect(score("", ["Tri-X 400"])).toBe(0);
  });

  it("prefers the more specific name when both share a prefix", () => {
    const specific = score("arista edu ultra 100", stockFields(CATALOG[6]));
    const general = score("arista edu ultra 100", stockFields(CATALOG[7]));
    expect(specific).toBeGreaterThan(general);
  });
});

describe("strictStockMatch", () => {
  it("resolves a partial-but-exact-token query", () => {
    const m = strictStockMatch("hp5", CATALOG, stockFields);
    expect(m.kind).toBe("single");
    if (m.kind === "single") expect(m.item.name).toBe("HP5 Plus");
  });

  it("resolves a full manufacturer + name query", () => {
    const m = strictStockMatch("Kodak Tri-X 400", CATALOG, stockFields);
    expect(m.kind).toBe("single");
    if (m.kind === "single") expect(m.item.name).toBe("Tri-X 400");
  });

  // Regression: bestMatch() scored the shared "Pan" token above zero and filed
  // new Verichrome Pan stock under Kodak Technical Pan.
  it("does not resolve an unknown stock onto a namesake", () => {
    expect(strictStockMatch("Verichrome Pan", CATALOG, stockFields).kind).toBe("none");
  });

  // Regression: "Washi F" matched the existing "Washi S" on the manufacturer token.
  it("does not resolve a sibling stock from the same manufacturer", () => {
    expect(strictStockMatch("Washi F", CATALOG, stockFields).kind).toBe("none");
  });

  it("does not resolve Ektapan onto Technical Pan", () => {
    expect(strictStockMatch("Kodak Ektapan", CATALOG, stockFields).kind).toBe("none");
  });

  it("reports ties instead of silently picking", () => {
    const twins = [stock("Foma", "Fomapan 100", 100), stock("Foma", "Fomapan 100", 100)];
    const m = strictStockMatch("Fomapan 100", twins, stockFields);
    expect(m.kind).toBe("tied");
    if (m.kind === "tied") expect(m.items).toHaveLength(2);
  });

  it("returns none for an empty query", () => {
    expect(strictStockMatch("", CATALOG, stockFields).kind).toBe("none");
  });
});

describe("bestMatch", () => {
  it("still picks a clear winner", () => {
    expect(bestMatch("Delta 100", CATALOG, stockFields)?.name).toBe("Delta 100");
  });

  // Documents exactly why add_inventory no longer uses it for stock resolution.
  it("is loose enough to pick a namesake — hence strictStockMatch", () => {
    expect(bestMatch("Verichrome Pan", CATALOG, stockFields)).not.toBeNull();
  });

  it("returns null when nothing scores", () => {
    expect(bestMatch("velvia", CATALOG, stockFields)).toBeNull();
  });
});

describe("rankedMatch", () => {
  it("reports none, single, and tied", () => {
    expect(rankedMatch("velvia", CATALOG, stockFields).kind).toBe("none");
    expect(rankedMatch("Delta 100", CATALOG, stockFields).kind).toBe("single");

    const twins = [stock("Foma", "Fomapan 100", 100), stock("Foma", "Fomapan 100", 100)];
    expect(rankedMatch("Fomapan 100", twins, stockFields).kind).toBe("tied");
  });
});

describe("cleanStockName", () => {
  it("strips a leading manufacturer", () => {
    expect(cleanStockName("Kentmere Pan 400", "Kentmere")).toBe("Pan 400");
  });

  it("is case-insensitive about the prefix", () => {
    expect(cleanStockName("kodak Tri-X 400", "Kodak")).toBe("Tri-X 400");
  });

  it("leaves a name that does not start with the manufacturer", () => {
    expect(cleanStockName("Tri-X 400", "Kodak")).toBe("Tri-X 400");
  });

  it("tolerates an empty manufacturer", () => {
    expect(cleanStockName("  Tri-X 400  ", "")).toBe("Tri-X 400");
  });
});

describe("displayStock", () => {
  it("prefixes the manufacturer when the name lacks it", () => {
    expect(displayStock("Kodak", "Tri-X 400")).toBe("Kodak Tri-X 400");
  });

  it("does not double up when the name already carries it", () => {
    expect(displayStock("Kentmere", "Kentmere Pan 100")).toBe("Kentmere Pan 100");
  });

  it("collapses a name identical to the manufacturer", () => {
    expect(displayStock("Washi", "washi")).toBe("washi");
  });
});
