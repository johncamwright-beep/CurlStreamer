import "server-only";
import nodemailer from "nodemailer";
import { z } from "zod";
const configSchema = z.object({
  host: z
    .string()
    .regex(
      /^(smtp|smtppro)\.(zoho\.(com|eu|in|com\.au|jp|ca|com\.cn)|zohocloud\.ca)$/,
    ),
  port: z.enum(["465", "587"]),
  user: z.email(),
  password: z.string().min(1),
  from: z.email(),
});
export function reportMailConfig() {
  return configSchema.safeParse({
    host: process.env.ZOHO_SMTP_HOST,
    port: process.env.ZOHO_SMTP_PORT ?? "465",
    user: process.env.ZOHO_SMTP_USER,
    password: process.env.ZOHO_SMTP_PASSWORD,
    from: process.env.INVITATION_FROM_EMAIL,
  });
}
/** One composed message with visible To/CC and an in-memory PDF attachment. */
export async function deliverReportEmail(input: {
  to: string[];
  cc: string[];
  title: string;
  eventName: string;
  pdf: Buffer;
  filename: string;
  subject: string;
  message: string;
  senderName: string;
}) {
  const config = reportMailConfig();
  if (
    !config.success ||
    !z
      .string()
      .max(184)
      .regex(/^[^<>:"/\\|?*\u0000-\u001f\u007f]+\.pdf$/)
      .safeParse(input.filename).success ||
    !z.array(z.email()).min(1).max(50).safeParse(input.to).success ||
    !z.array(z.email()).max(50).safeParse(input.cc).success ||
    !z
      .string()
      .min(1)
      .max(200)
      .regex(/^[^\r\n\u0000]+$/)
      .safeParse(input.subject).success ||
    !z
      .string()
      .min(1)
      .max(106)
      .regex(/^[^\r\n\u0000]+$/)
      .safeParse(input.senderName).success
  )
    return "failed" as const;
  const c = config.data;
  const transport = nodemailer.createTransport({
    host: c.host,
    port: Number(c.port),
    secure: c.port === "465",
    requireTLS: true,
    auth: { user: c.user, pass: c.password },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  try {
    const result = await transport.sendMail({
      from: { name: input.senderName, address: c.from },
      to: input.to.map((address) => ({ name: "", address })),
      cc: input.cc.map((address) => ({ name: "", address })),
      subject: input.subject,
      text: input.message,
      attachments: [
        {
          filename: input.filename,
          content: input.pdf,
          contentType: "application/pdf",
        },
      ],
    });
    const accepted = new Set(
      result.accepted.map((address) => address.toLowerCase()),
    );
    if (!accepted.size) return "failed" as const;
    // Partial SMTP acceptance is uncertain: never silently resend to the whole group.
    return [...input.to, ...input.cc].every((address) =>
      accepted.has(address.toLowerCase()),
    )
      ? ("accepted" as const)
      : ("unknown" as const);
  } catch {
    // A timeout can occur after SMTP acceptance: do not silently retry.
    return "unknown" as const;
  } finally {
    transport.close();
  }
}
