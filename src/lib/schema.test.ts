import { describe, expect, it } from "vitest";
import { hasSafeSponsorContent } from "./schema";

describe("sponsor content validation", () => {
  it("accepts supported signatures and bundled mock assets", () => {
    expect(hasSafeSponsorContent("/sponsors/community.svg")).toBe(true);
    expect(hasSafeSponsorContent("data:image/jpeg;base64,/9j/AA==")).toBe(true);
    expect(hasSafeSponsorContent("data:image/png;base64,iVBORw0KGgo=")).toBe(
      true,
    );
    expect(
      hasSafeSponsorContent("data:image/webp;base64,UklGRgAAAABXRUJQ"),
    ).toBe(true);
  });

  it("rejects spoofed image content and executable formats", () => {
    expect(hasSafeSponsorContent("data:image/png;base64,PHNjcmlwdD4=")).toBe(
      false,
    );
    expect(
      hasSafeSponsorContent("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="),
    ).toBe(false);
    expect(
      hasSafeSponsorContent("data:text/html;base64,PGgxPkJvb208L2gxPg=="),
    ).toBe(false);
  });
});
