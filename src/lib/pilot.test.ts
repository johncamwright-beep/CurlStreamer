import { expect, it } from "vitest";
import { pilotPasswordRequired, pilotInput } from "./pilot";
it("requires trusted password flags and validates private contacts", () => {
  expect(
    pilotPasswordRequired({ app_metadata: { pilot_password_required: true } }),
  ).toBe(true);
  expect(
    pilotPasswordRequired({ app_metadata: { pilot_setup_pending: true } }),
  ).toBe(true);
  expect(pilotPasswordRequired(null)).toBe(false);
  expect(
    pilotInput.safeParse({
      name: "Owner",
      email: "person@example.test",
      phone: "invalid",
      team: "Team",
      expiresAt: "2027-01-01T00:00:00Z",
      coachSeats: 1,
    }).success,
  ).toBe(false);
});
