import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { NewsContent } from "./NewsContent";
import {
  legacyNewsContent,
  newsContentSchema,
  newsPlainText,
} from "@/lib/news-content";

it("preserves legacy text and escapes markup", () => {
  const html = renderToStaticMarkup(
    <NewsContent
      content={null}
      summary={"First line\n<script>alert(1)</script>"}
    />,
  );
  expect(html).toContain("First line\n&lt;script&gt;");
  expect(html).not.toContain("<script>");
  expect(newsContentSchema.safeParse(legacyNewsContent("")).success).toBe(true);
});

it("renders formatted text and contained photos in document order", () => {
  const content = newsContentSchema.parse({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Before", marks: [{ type: "bold" }] }],
      },
      {
        type: "image",
        attrs: { src: "https://example.com/rink.png", alt: "Our curling rink" },
      },
      { type: "paragraph", content: [{ type: "text", text: "After" }] },
    ],
  });
  const html = renderToStaticMarkup(
    <NewsContent content={content} summary="Fallback" />,
  );
  expect(html).toContain("<strong>Before</strong>");
  expect(html).toContain('alt="Our curling rink"');
  expect(html).toContain("object-contain");
  expect(html.indexOf("Before")).toBeLessThan(
    html.indexOf('alt="Our curling rink"'),
  );
  expect(html.indexOf('alt="Our curling rink"')).toBeLessThan(
    html.indexOf("After"),
  );
  expect(newsPlainText(content)).toContain("Before\n");
});

it("rejects executable URLs instead of rendering supplied markup", () => {
  for (const src of ["javascript:alert(1)", "data:image/svg+xml,<svg/>"]) {
    const content = {
      type: "doc",
      content: [{ type: "image", attrs: { src, alt: "" } }],
    };
    expect(newsContentSchema.safeParse(content).success).toBe(false);
    expect(
      renderToStaticMarkup(
        <NewsContent content={content} summary="Safe fallback" />,
      ),
    ).not.toContain("<img");
  }
});
