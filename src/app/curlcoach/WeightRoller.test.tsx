import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { allWeights, weightLabels } from "@/lib/curlcoach/shot-subtypes";
import WeightRoller from "./WeightRoller";

function render(value?: string, initialValue?: string) {
  const onCommit = vi.fn();
  const markup = renderToStaticMarkup(
    <WeightRoller
      label="Observed weight"
      weights={allWeights}
      labels={weightLabels}
      value={value}
      initialValue={initialValue}
      blank="Not assessed"
      onCommit={onCommit}
    />,
  );
  expect(onCommit).not.toHaveBeenCalled();
  return markup;
}

describe("weight roller's initial display", () => {
  it("describes a called weight as a starting point for an unset observation", () => {
    const markup = render(undefined, "hack");

    expect(markup).toContain('aria-label="Observed weight"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toMatch(/>Hack<small[^>]*> \(called\)<\/small>/);
    expect(markup).toContain('aria-selected="true">Hack</div>');
    expect(markup).toMatch(/aria-label="Clear weight" disabled/);
  });

  it("uses the recorded observation before the called starting point", () => {
    const markup = render("top_4", "hack");

    expect(markup).not.toContain("(called)");
    expect(markup).toContain('aria-selected="true">Top 4</div>');
    expect(markup).not.toMatch(/aria-label="Clear weight" disabled/);
    expect(markup.match(/role="option"/g)).toHaveLength(allWeights.length);
  });

  it("keeps an out-of-list saved value visible and clearable", () => {
    const markup = render("back_button");

    expect(markup).toMatch(
      />Back button<small[^>]*> \(previous selection\)<\/small>/,
    );
    expect(markup).not.toContain(">Back button</div>");
    expect(markup).not.toMatch(/aria-label="Clear weight" disabled/);
    expect(render(undefined, "invalid")).toContain(">Not assessed</span>");
  });
});
