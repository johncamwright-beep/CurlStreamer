import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ROCK_COLOUR_PRESETS, RockColourSelector } from "./RockColourSelector";

describe("RockColourSelector", () => {
  it("offers ten named, touch-sized preset swatches", () => {
    const markup = renderToStaticMarkup(
      <RockColourSelector
        name="homeColor"
        label="Team 1 rock colour"
        defaultValue="#ef4444"
      />,
    );

    expect(ROCK_COLOUR_PRESETS).toHaveLength(10);
    for (const preset of ROCK_COLOUR_PRESETS)
      expect(markup).toContain(
        `aria-label="Team 1 rock colour: ${preset.name}"`,
      );
    expect(markup).toContain("min-h-11 min-w-11");
    expect(markup).toContain('name="homeColor" value="#ef4444"');
  });

  it("preserves an arbitrary saved hex value as Custom", () => {
    const markup = renderToStaticMarkup(
      <RockColourSelector
        name="awayColor"
        label="Team 2 rock colour"
        defaultValue="#13579b"
      />,
    );

    expect(markup).toContain('name="awayColor" value="#13579b"');
    expect(markup).toContain('aria-label="Team 2 rock colour: Custom"');
    expect(markup).toContain('checked="" value="custom"');
    expect(markup).toContain("Selected: Custom #13579B");
  });
});
