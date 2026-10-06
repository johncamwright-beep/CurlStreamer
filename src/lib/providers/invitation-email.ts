import "server-only";
import nodemailer from "nodemailer";
import { z } from "zod";

const settingsSchema = z.object({
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

export async function sendTeamInvitationEmail(input: {
  to: string;
  url: string;
  role: string;
}) {
  const settings = settingsSchema.safeParse({
    host: process.env.ZOHO_SMTP_HOST,
    port: process.env.ZOHO_SMTP_PORT ?? "465",
    user: process.env.ZOHO_SMTP_USER,
    password: process.env.ZOHO_SMTP_PASSWORD,
    from: process.env.INVITATION_FROM_EMAIL,
  });
  if (!settings.success)
    return { emailSent: false, emailStatus: "not_configured" as const };
  const parsed = z
    .object({
      to: z.email(),
      url: z.url(),
      role: z.enum(["team_admin", "game_operator"]),
    })
    .safeParse(input);
  if (!parsed.success || new URL(input.url).protocol !== "https:")
    return { emailSent: false, emailStatus: "failed" as const };
  const config = settings.data;
  const transport = nodemailer.createTransport({
    host: config.host,
    port: Number(config.port),
    secure: config.port === "465",
    requireTLS: true,
    auth: { user: config.user, pass: config.password },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  const access =
    input.role === "team_admin"
      ? "full access to manage team settings and access"
      : "game operations access to run games and broadcasts";
  const text = `You’ve been invited to join a team on CurlStreamer with ${access}.\n\nOpen your private invitation:\n${input.url}\n\n1. Create an account using any email address you prefer, or sign in.\n2. Confirm your email if you create an account with a password.\n3. Select Join team. You do not need to create a new team.\n\nThis link can be used by one person and expires in seven days. Please do not forward it.\n\nIf you weren’t expecting an invitation, you can ignore this email.`;
  try {
    const result = await transport.sendMail({
      from: { name: "CurlStreamer", address: config.from },
      to: { address: input.to, name: "" },
      subject: "You’re invited to join a team on CurlStreamer",
      text,
    });
    const sent = result.accepted.length > 0;
    return {
      emailSent: sent,
      emailStatus: sent ? ("sent" as const) : ("failed" as const),
    };
  } catch {
    // Never log SMTP errors: provider messages may contain credentials or invitation content.
    return { emailSent: false, emailStatus: "failed" as const };
  } finally {
    transport.close();
  }
}
