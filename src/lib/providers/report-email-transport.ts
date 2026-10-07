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
/** A single recipient per message: no shared To/CC list and no remote attachments. */
export async function deliverReportEmail(input: {
  to: string;
  title: string;
  eventName: string;
  pdf: Buffer;
  subject: string;
  message: string;
  senderName: string;
}) {
  const config = reportMailConfig();
  if (
    !config.success ||
    !z.email().safeParse(input.to).success ||
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
      to: { name: "", address: input.to },
      subject: input.subject,
      text: input.message,
      attachments: [
        {
          filename: "shot-tracker-report.pdf",
          content: input.pdf,
          contentType: "application/pdf",
        },
      ],
    });
    return result.accepted.length ? ("accepted" as const) : ("failed" as const);
  } catch {
    // A timeout can occur after SMTP acceptance: do not silently retry.
    return "unknown" as const;
  } finally {
    transport.close();
  }
}
