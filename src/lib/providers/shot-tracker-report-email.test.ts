import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  load: vi.fn(),
  reports: vi.fn(),
  current: vi.fn(),
  contacts: vi.fn(),
  coaches: vi.fn(),
  rpc: vi.fn(),
  send: vi.fn(),
  pdf: vi.fn(),
}));
vi.mock("./shot-tracker-reports", () => ({
  loadReportEvent: m.load,
  getEventReports: m.reports,
  ReportError: class extends Error {
    constructor(
      message: string,
      public status: number,
    ) {
      super(message);
    }
  },
}));
vi.mock("./player-contacts", () => ({
  currentPlayerContacts: m.current,
  readPlayerContacts: m.contacts,
  readCoachContacts: m.coaches,
}));
vi.mock("./report-email-transport", () => ({
  reportMailConfig: () => ({ success: true }),
  deliverReportEmail: m.send,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: m.rpc }),
}));
vi.mock("@/lib/curlcoach/report-pdf", () => ({ buildReportPDF: m.pdf }));
import {
  prepareReportEmail,
  sendReportEmail,
  emailRequest,
} from "./shot-tracker-report-email";
import type { CoachAccount } from "@/lib/curlcoach/production-access";
const account = { userId: "coach", organizationId: "org" } as CoachAccount;
const selection = {
  eventId: "11111111-1111-4111-8111-111111111111",
  audience: "players" as const,
  reportKey: "player-1",
};
let packet: {
  eventName: string;
  audience: string;
  reports: { key: string; title: string; playerId?: string }[];
};
beforeEach(() => {
  vi.clearAllMocks();
  m.coaches.mockResolvedValue(["", ""]);
  packet = {
    eventName: "Event",
    audience: "players",
    reports: [
      { key: "player-1", title: "Pat", playerId: "player-stable" },
      { key: "player-2", title: "Sam", playerId: "other" },
    ],
  };
  m.load.mockResolvedValue({ id: selection.eventId });
  m.reports.mockImplementation(async () => ({
    entries: [{ audience: packet.audience, status: "ready", packet }],
  }));
  m.contacts.mockResolvedValue([
    { player_id: "other", player_name: "Sam", email: "sam@example.com" },
    {
      player_id: "player-stable",
      player_name: "Pat",
      email: "pat@example.com",
    },
  ]);
  m.current.mockResolvedValue([
    { id: "a", name: "Pat", email: "pat@example.com" },
    { id: "b", name: "Sam", email: "sam@example.com" },
    { id: "c", name: "Alex", email: "" },
  ]);
  m.pdf.mockResolvedValue({ output: () => new ArrayBuffer(8) });
  m.send.mockResolvedValue("accepted");
  m.rpc.mockImplementation(async (name: string) => ({
    data: name === "claim_report_email" ? "claimed" : true,
    error: null,
  }));
});
it("previews without sending and selects by stable identity, not array position", async () => {
  const plan = await prepareReportEmail(account, selection);
  expect(plan.preview.recipients.map((p) => p.email)).toEqual([
    "pat@example.com",
  ]);
  expect(m.send).not.toHaveBeenCalled();
  await sendReportEmail(account, {
    ...selection,
    planToken: plan.preview.planToken,
    resend: false,
    coachName: "John Wright",
    subject: "Event report",
    coachMessage: "Please review before practice.",
    cc: [],
  });
  expect(m.send).toHaveBeenCalledOnce();
  expect(m.send.mock.calls[0][0].to).toBe("pat@example.com");
  expect(m.pdf.mock.calls[0][0]).toEqual(packet.reports[0]);
});
it("rejects a contact change after the recipient preview", async () => {
  const plan = await prepareReportEmail(account, selection);
  m.contacts.mockResolvedValue([
    {
      player_id: "player-stable",
      player_name: "Pat",
      email: "different@example.com",
    },
  ]);
  await expect(
    sendReportEmail(account, {
      ...selection,
      planToken: plan.preview.planToken,
      resend: false,
      coachName: "John Wright",
      subject: "Event report",
      coachMessage: "Please review before practice.",
      cc: [],
    }),
  ).rejects.toThrow(/changed/);
  expect(m.send).not.toHaveBeenCalled();
});
it("refuses legacy reports with no reliable identity and forbids coach reports or client destinations", async () => {
  delete packet.reports[0].playerId;
  await expect(prepareReportEmail(account, selection)).rejects.toThrow(
    /safely linked/,
  );
  expect(
    emailRequest.safeParse({
      ...selection,
      audience: "coach",
      planToken: "a".repeat(64),
    }).success,
  ).toBe(false);
  expect(
    emailRequest.safeParse({
      ...selection,
      to: "attacker@example.com",
      planToken: "a".repeat(64),
    }).success,
  ).toBe(false);
});
it("sends a team report separately to unique roster emails and reports missing addresses", async () => {
  packet.audience = "team";
  packet.reports = [{ key: "team", title: "Team report" }];
  const input = { ...selection, audience: "team" as const, reportKey: "team" };
  const plan = await prepareReportEmail(account, input);
  expect(plan.preview.skipped).toEqual(["Alex"]);
  await sendReportEmail(account, {
    ...input,
    planToken: plan.preview.planToken,
    resend: false,
    coachName: "John Wright",
    subject: "Event report",
    coachMessage: "Please review before practice.",
    cc: [],
  });
  expect(m.send).toHaveBeenCalledTimes(2);
  expect(m.send.mock.calls.map((c) => c[0].to)).toEqual([
    "pat@example.com",
    "sam@example.com",
  ]);
});
it("does not resend a claimed delivery on repeated clicks", async () => {
  m.rpc.mockResolvedValue({ data: "accepted", error: null });
  const plan = await prepareReportEmail(account, selection);
  const result = await sendReportEmail(account, {
    ...selection,
    planToken: plan.preview.planToken,
    resend: false,
    coachName: "John Wright",
    subject: "Event report",
    coachMessage: "Please review before practice.",
    cc: [],
  });
  expect(m.send).not.toHaveBeenCalled();
  expect(result.results[0].status).toBe("accepted");
});
it("copies only the selected report once per address, deduplicating roster and CC", async () => {
  const plan = await prepareReportEmail(account, selection);
  await sendReportEmail(account, {
    ...selection,
    planToken: plan.preview.planToken,
    resend: false,
    coachName: "Coach John Wright",
    subject: "Practice follow-up",
    coachMessage: "Please review.\n\nJohn",
    cc: ["parent@example.com", "PARENT@example.com", "pat@example.com"],
  });
  expect(m.send.mock.calls.map((c) => c[0].to.toLowerCase())).toEqual([
    "pat@example.com",
    "parent@example.com",
  ]);
  expect(m.send).toHaveBeenCalledWith(
    expect.objectContaining({
      senderName: "Coach John Wright",
      subject: "Practice follow-up",
      message: "Please review.\n\nJohn",
    }),
  );
  expect(m.pdf).toHaveBeenCalledOnce();
  expect(m.pdf.mock.calls[0][0]).toEqual(packet.reports[0]);
});
it("validates editable headers, message length and copy recipients", () => {
  const valid = {
    ...selection,
    planToken: "a".repeat(64),
    coachName: "John Wright",
    subject: "Review",
    coachMessage: "Hi team",
    cc: [],
  };
  expect(emailRequest.safeParse(valid).success).toBe(true);
  for (const extra of [
    { subject: "Review\r\nBcc: stranger@example.com" },
    { coachName: "John\nWright" },
    { coachMessage: " " },
    { coachMessage: "x".repeat(10001) },
    { cc: ["invalid"] },
    { cc: Array(11).fill("parent@example.com") },
  ])
    expect(emailRequest.safeParse({ ...valid, ...extra }).success).toBe(false);
});
it("includes all parents on team reports and only the selected player's parent on individual reports, plus both coaches", async () => {
  m.coaches.mockResolvedValue(["coach1@example.com", "coach2@example.com"]);
  m.contacts.mockResolvedValue([
    {
      player_id: "player-stable",
      player_name: "Pat",
      email: null,
      parent_email: "pat-parent@example.com",
    },
    {
      player_id: "other",
      player_name: "Sam",
      email: "sam@example.com",
      parent_email: "sam-parent@example.com",
    },
  ]);
  const individual = await prepareReportEmail(account, selection);
  expect(individual.preview.recipients.map((p) => p.email)).toEqual([
    "pat-parent@example.com",
    "coach1@example.com",
    "coach2@example.com",
  ]);
  expect(individual.preview.skipped).toEqual([]);
  packet.audience = "team";
  packet.reports = [{ key: "team", title: "Team report" }];
  m.current.mockResolvedValue([
    {
      id: "a",
      name: "Pat",
      email: "pat@example.com",
      parentEmail: "parent@example.com",
    },
    { id: "b", name: "Sam", email: "", parentEmail: "PARENT@example.com" },
  ]);
  const team = await prepareReportEmail(account, {
    ...selection,
    audience: "team",
    reportKey: "team",
  });
  expect(team.preview.recipients.map((p) => p.email)).toEqual([
    "pat@example.com",
    "parent@example.com",
    "coach1@example.com",
    "coach2@example.com",
  ]);
  expect(team.preview.skipped).toEqual([]);
});
it.each(["team", "players"] as const)(
  "automatically delivers a private sender copy for %s reports, without duplicate saved-coach or CC copies",
  async (audience) => {
    const sender = {
      ...account,
      user: { email: "john@example.com" },
    } as CoachAccount;
    packet.audience = audience;
    const input = { ...selection, audience };
    m.coaches.mockResolvedValue(["JOHN@example.com", ""]);
    const plan = await prepareReportEmail(sender, input);
    expect(plan.preview.recipients).toContainEqual({
      playerId: "sender:coach",
      name: "You (coach copy)",
      email: "john@example.com",
    });
    expect(m.send).not.toHaveBeenCalled();
    await sendReportEmail(sender, {
      ...input,
      planToken: plan.preview.planToken,
      resend: false,
      coachName: "John",
      subject: "Review",
      coachMessage: "Please review",
      cc: ["John@example.com"],
    });
    const copies = m.send.mock.calls.filter(
      ([mail]) => mail.to.toLowerCase() === "john@example.com",
    );
    expect(copies).toHaveLength(1);
    expect(copies[0][0]).toMatchObject({
      subject: "Review",
      message: "Please review",
    });
    expect(copies[0][0].pdf).toEqual(m.send.mock.calls[0][0].pdf);
  },
);
it("requires another review if the authenticated sender email changes", async () => {
  const sender = {
    ...account,
    user: { email: "john@example.com" },
  } as CoachAccount;
  const plan = await prepareReportEmail(sender, selection);
  await expect(
    sendReportEmail(
      { ...sender, user: { ...sender.user, email: "new@example.com" } },
      {
        ...selection,
        planToken: plan.preview.planToken,
        resend: false,
        coachName: "John",
        subject: "Review",
        coachMessage: "Please review",
        cc: [],
      },
    ),
  ).rejects.toThrow(/changed/);
  expect(m.send).not.toHaveBeenCalled();
});
it("greets individual players by first name and keeps the team greeting", async () => {
  packet.reports[0].title = "Owen McTavish";
  const individual = await prepareReportEmail(account, selection);
  expect(individual.preview.coachMessage).toMatch(/^Hi Owen,/);
  expect(individual.preview.title).toBe("Owen McTavish");
  packet.audience = "team";
  const team = await prepareReportEmail(account, {
    ...selection,
    audience: "team",
  });
  expect(team.preview.coachMessage).toMatch(/^Hi team,/);
});
it("rejects parent or coach contact changes after recipient review", async () => {
  const plan = await prepareReportEmail(account, selection);
  m.coaches.mockResolvedValue(["added@example.com", ""]);
  await expect(
    sendReportEmail(account, {
      ...selection,
      planToken: plan.preview.planToken,
      resend: false,
      coachName: "John",
      subject: "Review",
      coachMessage: "Please review",
      cc: [],
    }),
  ).rejects.toThrow(/changed/);
  expect(m.send).not.toHaveBeenCalled();
});
