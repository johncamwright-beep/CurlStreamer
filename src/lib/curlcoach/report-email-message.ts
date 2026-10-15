import { z } from "zod";

const header = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\r\n\u0000]+$/);
export const reportEmailMessage = z.object({
  coachName: header(100),
  subject: header(200),
  coachMessage: z
    .string()
    .trim()
    .min(1)
    .max(10000)
    .refine((s) => !s.includes("\u0000")),
  cc: z.array(z.email().max(254)).max(10).default([]),
});
export function coachSenderName(name: string) {
  return `Coach ${name.trim().replace(/^Coach\s+/i, "")}`;
}
