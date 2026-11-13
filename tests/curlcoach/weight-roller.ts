import { expect, type Page } from "@playwright/test";
import {
  allWeights,
  weightLabels,
} from "../../src/lib/curlcoach/shot-subtypes";

type WeightField = "Called weight" | "Observed weight";

export function weightField(page: Page, name: WeightField) {
  return page.getByRole("button", { name, exact: true });
}

export async function openWeight(page: Page, name: WeightField) {
  await weightField(page, name).click();
  const dialog = page.getByRole("dialog", { name, exact: true });
  const wheel = dialog.getByRole("listbox", { name, exact: true });
  await expect(wheel).toBeFocused();
  return { dialog, wheel };
}

export async function chooseWeight(page: Page, name: WeightField, key: string) {
  const { dialog, wheel } = await openWeight(page, name);
  if (!key) {
    await dialog.getByRole("button", { name: "Clear weight" }).click();
  } else {
    let index = allWeights.indexOf(key);
    expect(index).toBeGreaterThanOrEqual(0);
    await wheel.press("Home");
    for (; index >= 3; index -= 3) await wheel.press("PageDown");
    for (; index > 0; index--) await wheel.press("ArrowDown");
    await expect(wheel.getByRole("option", { selected: true })).toHaveText(
      weightLabels[key],
    );
    await wheel.press("Enter");
  }
  await expect(dialog).toBeHidden();
}
