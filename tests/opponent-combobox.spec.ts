import { build } from "esbuild";
import { expect, test } from "@playwright/test";

let javascript: string;

test.beforeAll(async () => {
  const bundle = await build({
    bundle: true,
    format: "iife",
    jsx: "automatic",
    platform: "browser",
    write: false,
    tsconfig: "tsconfig.json",
    stdin: {
      contents: `
        import React, { useState } from "react";
        import { createRoot } from "react-dom/client";
        import { OpponentCombobox } from "./src/components/OpponentCombobox";
        function Harness() {
          const [choice, setChoice] = useState({ id: "__tbd", name: "" });
          const [clicks, setClicks] = useState(0);
          return <>
            <label htmlFor="opponent">Opponent</label>
            <OpponentCombobox id="opponent" options={[
              { id: "king", display_name: "Team   King" },
              { id: "wright", display_name: "Team Wright" }
            ]} value={choice.id} displayName={choice.name}
              onSelect={(id, name) => setChoice({id, name})} />
            <button onClick={() => setClicks((count) => count + 1)}>Next field</button>
            <output aria-label="Next field clicks">{clicks}</output>
            <output aria-label="Selected opponent">{choice.id}</output>
          </>;
        }
        createRoot(document.getElementById("root")).render(<Harness />);
      `,
      loader: "tsx",
      resolveDir: process.cwd(),
    },
  });
  javascript = bundle.outputFiles[0].text;
});

test.beforeEach(async ({ page }) => {
  await page.route("http://opponent-fixture.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><div id="root"></div><script>${javascript}</script>`,
    }),
  );
  await page.goto("http://opponent-fixture.test/");
});

test("TBD starts without an unfiltered menu; normalized substring search is keyboard accessible", async ({
  page,
}) => {
  const input = page.getByRole("combobox", { name: "Opponent", exact: true });
  await expect(input).toHaveValue("TBD");
  await input.focus();
  await expect(page.getByRole("option")).toHaveCount(0);
  await input.fill(" kInG ");
  await expect(page.getByRole("option")).toHaveCount(1);
  await input.press("ArrowUp");
  await expect(input).toHaveAttribute(
    "aria-activedescendant",
    "opponent-results-0",
  );
  await input.press("Enter");
  await expect(input).toHaveValue("Team   King");
  await expect(page.getByLabel("Selected opponent")).toHaveText("king");
  await input.fill(" team king ");
  await expect(page.getByRole("option")).toHaveCount(1);
  await page.getByRole("option", { name: "Team King", exact: true }).click();
  await expect(page.getByLabel("Selected opponent")).toHaveText("king");
});

test("unmatched text invalidates a prior selection, Escape restores it and clearing chooses TBD", async ({
  page,
}) => {
  const input = page.getByRole("combobox", { name: "Opponent", exact: true });
  await input.fill("Wright");
  await page.getByRole("option", { name: "Team Wright", exact: true }).click();
  await input.fill("No such team");
  await expect(page.getByLabel("Selected opponent")).toHaveText("");
  await input.press("Enter");
  await expect(input).toHaveValue("No such team");
  await page.getByRole("button", { name: "Next field" }).click();
  await expect(page.getByLabel("Next field clicks")).toHaveText("1");
  await expect(
    page.getByText("No matching opponents.", { exact: false }),
  ).toBeVisible();
  await expect(input).toHaveValue("No such team");
  await input.focus();
  await input.press("Escape");
  await expect(input).toHaveValue("Team Wright");
  await input.fill("");
  await expect(input).toHaveValue("TBD");
  await expect(page.getByLabel("Selected opponent")).toHaveText("__tbd");
  await expect(page.getByRole("option")).toHaveCount(0);
});
