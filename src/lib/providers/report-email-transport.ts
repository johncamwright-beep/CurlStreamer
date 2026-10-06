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
}) {
  const config = reportMailConfig();
  if (!config.success || !z.email().safeParse(input.to).success)
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
      from: { name: "CurlStreamer", address: c.from },
      to: { name: "", address: input.to },
      subject: `${input.eventName} - ${input.title}`
        .replace(/[\r\n]/g, " ")
        .slice(0, 200),
      text: `Your team has shared this Shot Tracker report with you.\n\n${input.eventName}\n${input.title}\n\nYour report is attached as a PDF. You do not need a CurlStreamer account to read it. Please keep individual reports private.`,
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
