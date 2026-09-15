import { z } from "zod";
import { defaultTeamTheme } from "./team-page-theme";
const reserved = new Set([
  "www",
  "api",
  "auth",
  "admin",
  "app",
  "studio",
  "support",
  "mail",
  "account",
]);
const social = (hosts: string[]) =>
  z
    .string()
    .trim()
    .max(300)
    .refine((value) => {
      if (!value) return true;
      try {
        const url = new URL(value);
        return (
          url.protocol === "https:" &&
          !url.username &&
          !url.password &&
          hosts.includes(url.hostname.toLowerCase())
        );
      } catch {
        return false;
      }
    }, "Use the full HTTPS profile link.");
export const throwingPositions = ["fourth", "third", "second", "lead"] as const;
export const teamRosterSchema = z.object({
  fourth: z.string().trim().max(100).default(""),
  third: z.string().trim().max(100).default(""),
  second: z.string().trim().max(100).default(""),
  lead: z.string().trim().max(100).default(""),
  skip: z.enum(throwingPositions).default("fourth"),
});
export const teamPageSettingsSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    theme: z
      .object({
        background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        panel: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      })
      .default(defaultTeamTheme),
    tagline: z.string().trim().max(160).default(""),
    gallery: z
      .array(
        z.object({
          id: z.uuid(),
          url: z.string().url().max(1000),
          caption: z.string().trim().max(200),
        }),
      )
      .max(50)
      .default([]),
    photos: z.boolean().default(true),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(3)
      .max(48)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .refine(
        (value) => !reserved.has(value),
        "Choose a different team address.",
      ),
    roster: teamRosterSchema.default({
      fourth: "",
      third: "",
      second: "",
      lead: "",
      skip: "fourth",
    }),
    accomplishments: z.boolean().default(true),
    description: z.string().trim().max(1000),
    photo: z.union([z.literal(""), z.string().url().max(1000)]).default(""),
    published: z.boolean(),
    results: z.boolean(),
    upcoming: z.boolean(),
    news: z.boolean(),
    sponsors: z.boolean(),
    socials: z.boolean(),
    facebook: social(["facebook.com", "www.facebook.com"]),
    instagram: social(["instagram.com", "www.instagram.com"]),
  })
  .strict();
export type TeamPageSettings = z.infer<typeof teamPageSettingsSchema>;
export function defaultTeamPageSettings(name: string): TeamPageSettings {
  return {
    name,
    theme: { ...defaultTeamTheme },
    tagline: "",
    gallery: [],
    photos: true,
    slug: name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, ""),
    roster: { fourth: "", third: "", second: "", lead: "", skip: "fourth" },
    accomplishments: true,
    description: "",
    photo: "",
    published: false,
    results: true,
    upcoming: true,
    news: true,
    sponsors: true,
    socials: true,
    facebook: "",
    instagram: "",
  };
}
