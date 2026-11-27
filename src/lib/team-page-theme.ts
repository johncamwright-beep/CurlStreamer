import type { CSSProperties } from "react";
export const defaultTeamTheme = {
  background: "#edf2f7",
  panel: "#ffffff",
  accent: "#0e7490",
};
export function luminance(hex: string) {
  const rgb = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
export function contrastText(hex: string) {
  return luminance(hex) > 0.179 ? "#000000" : "#ffffff";
}
export function teamThemeStyle(theme: typeof defaultTeamTheme): CSSProperties {
  const a = luminance(theme.accent),
    p = luminance(theme.panel);
  const ratio = (Math.max(a, p) + 0.05) / (Math.min(a, p) + 0.05);
  return {
    "--page-bg": theme.background,
    "--page-text": contrastText(theme.background),
    "--panel-bg": theme.panel,
    "--panel-text": contrastText(theme.panel),
    "--accent": theme.accent,
    "--accent-text": contrastText(theme.accent),
    "--panel-link": ratio >= 4.5 ? theme.accent : contrastText(theme.panel),
  } as CSSProperties;
}
