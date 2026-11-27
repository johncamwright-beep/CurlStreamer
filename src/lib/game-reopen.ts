import { z } from "zod";

export const reopenGameSchema = z
  .object({
    requestId: z.uuid(),
    expectedRevision: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
