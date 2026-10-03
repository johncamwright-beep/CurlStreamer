import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { filterOpponents, OpponentCombobox } from "./OpponentCombobox";

const options = [
  { id: "king", display_name: "Team   King" },
  { id: "wright", display_name: "Team Wright" },
];

describe("OpponentCombobox", () => {
  it("matches substrings with normalized case and spaces", () => {
    expect(filterOpponents(options, "  kInG ")).toEqual([options[0]]);
    expect(filterOpponents(options, "team king")).toEqual([options[0]]);
    expect(filterOpponents(options, "granite")).toEqual([]);
  });

  it("never lists all opponents without a meaningful query and caps matches", () => {
    expect(filterOpponents(options, " ")).toEqual([]);
    expect(filterOpponents(options, "TBD")).toEqual([]);
    expect(
      filterOpponents(
        Array.from({ length: 20 }, (_, i) => ({
          id: String(i),
          display_name: `Team ${i}`,
        })),
        "team",
      ),
    ).toHaveLength(8);
  });

  it("renders a touch-sized accessible TBD input without an unfiltered menu", () => {
    const markup = renderToStaticMarkup(
      <OpponentCombobox
        id="opponent"
        options={options}
        value="__tbd"
        displayName=""
        onSelect={() => {}}
      />,
    );
    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('value="TBD"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-controls="opponent-results"');
    expect(markup).toContain("min-h-11");
    expect(markup).not.toContain('role="option"');
  });
});
