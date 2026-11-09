import "server-only";
import { createHash, randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { reportMailConfig } from "./report-email-transport";

// A resend rotates the temporary credential. It never resets an activated account.
export async function sendPilotCredentials(actor: string, id: string) {
  const db = createAdminSupabaseClient();
  const config = reportMailConfig();
  if (!config.success)
    throw Error("Email is not configured. The pilot remains saved.");
  const claimed = await db.rpc("claim_pilot_email", {
    p_actor: actor,
    p_id: id,
  });
  if (claimed.error || !claimed.data?.length)
    throw Error(
      "Invitation is active, expired, revoked, or already sending. Refresh and try again.",
    );
  let row = claimed.data[0];
  const attempt = row.email_attempt;
  const password = randomBytes(24).toString("base64url");
  const temporaryHash = createHash("sha256").update(password).digest("hex");
  const expires = new Date(
    Math.min(Date.now() + 7 * 86400000, Date.parse(row.expires_at)),
  ).toISOString();
  let status = "failed";
  try {
    if (!row.organization_id) {
      // Existing identities are never changed. Recovery only attaches a matching pilot_id.
      await db.auth.admin.createUser({
        email: row.email,
        password,
        email_confirm: true,
        app_metadata: {
          pilot_temporary_password_hash: temporaryHash,
          pilot_id: id,
          pilot_password_required: true,
          pilot_setup_pending: true,
          pilot_credentials_expire: expires,
        },
        user_metadata: { display_name: row.administrator_name },
      });
      const provisioned = await db.rpc("provision_pilot_account", {
        p_actor: actor,
        p_id: id,
      });
      if (provisioned.error || !provisioned.data?.user_id)
        throw Error(
          "Account setup could not finish. The saved pilot can be retried.",
        );
      row = provisioned.data;
    }
    const changed = await db.auth.admin.updateUserById(row.user_id, {
      password,
      app_metadata: {
        pilot_temporary_password_hash: temporaryHash,
        pilot_password_required: true,
        pilot_setup_pending: true,
        pilot_credentials_expire: expires,
      },
      user_metadata: {
        team_setup: {
          organizationId: row.organization_id,
          step: 1,
          complete: false,
        },
      },
    });
    if (changed.error)
      throw Error(
        "Temporary credentials could not be prepared. Retry the invitation.",
      );
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
        to: { name: row.administrator_name, address: row.email },
        subject: "Your CurlStreamer pilot account",
        text: `Hello ${row.administrator_name},\n\nYour private workspace for ${row.team_name} is ready.\n\nSign in: https://www.curlstreamer.app/login\nEmail: ${row.email}\nTemporary password: ${password}\n\nYou must choose your own password before using the platform. These temporary credentials expire ${expires}. A replacement invitation invalidates the previous password.\n\nAfter signing in, the setup guide will help you add your logo, players, public page, and first game. Your pilot access runs until ${row.expires_at}.\n\nPlease do not forward this email. Questions? Reply to hello@curlstreamer.app.`,
      });
      status = result.accepted.length ? "accepted" : "failed";
    } catch {
      status = "unknown";
    } finally {
      transport.close();
    }
    return { emailStatus: status };
  } finally {
    const finished = await db.rpc("finish_pilot_email", {
      p_id: id,
      p_attempt: attempt,
      p_status: status,
    });
    if (finished.error)
      throw Error(
        "Email status could not be confirmed. Check the recipient before resending.",
      );
  }
}
