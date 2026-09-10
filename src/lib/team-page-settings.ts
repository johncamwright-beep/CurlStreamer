import { z } from "zod";
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
export const teamPageSettingsSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
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
    slug: name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, ""),
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
