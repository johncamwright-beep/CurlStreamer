import { z } from "zod";
export const pilotInput = z.object({
  name: z.string().trim().min(1).max(100),
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  phone: z
    .string()
    .trim()
    .min(7)
    .max(40)
    .regex(/^[+\d(). x-]+$/),
  team: z.string().trim().min(1).max(100),
  expiresAt: z.iso.datetime({ offset: true }),
  coachSeats: z.number().int().min(0).max(3),
});
export function pilotPasswordRequired(
  user: { app_metadata?: Record<string, unknown> } | null,
) {
  return (
    user?.app_metadata?.pilot_password_required === true ||
    user?.app_metadata?.pilot_setup_pending === true
  );
}
