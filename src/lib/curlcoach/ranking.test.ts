import { describe, expect, it } from "vitest";
import { rankAnalysis } from "./ranking";
describe("analysis ranking", () => {
  const rows = [
    { name: "Missing", value: null },
    { name: "Zero", value: 0 },
    { name: "B", value: 80 },
    { name: "A", value: 80 },
    { name: "Best", value: 100 },
  ];
  const rank = (order: "ascending" | "descending" | "name") =>
    rankAnalysis(
      rows,
      order,
      (r) => r.value,
      (r) => r.name,
    ).map((r) => r.name);
  it("orders actual measurements with stable alphabetical ties and missing last", () => {
    expect(rank("descending")).toEqual(["Best", "A", "B", "Zero", "Missing"]);
    expect(rank("ascending")).toEqual(["Zero", "A", "B", "Best", "Missing"]);
    expect(rows[0].name).toBe("Missing");
  });
  it("supports name order", () =>
    expect(rank("name")).toEqual(["A", "B", "Best", "Missing", "Zero"]));
});
