import { expect, it } from "vitest";
import { newsContentSchema, newsPlainText } from "./news-content";

it("saves clipboard paragraphs with emoji, empty alignment and browser CSS values", () => {
  const result = newsContentSchema.parse({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "🏆 U18 Phoenix Champions!" }],
      },
      {
        type: "paragraph",
        attrs: { textAlign: "" },
        content: [
          {
            type: "text",
            text: "Seven straight wins!",
            marks: [
              {
                type: "textStyle",
                attrs: {
                  color: "rgb(56, 189, 248)",
                  fontFamily: '"Trebuchet MS"',
                  fontSize: "",
                },
              },
            ],
          },
        ],
      },
    ],
  });
  expect(newsPlainText(result)).toContain("🏆 U18 Phoenix Champions!");
  expect(JSON.stringify(result)).toContain('"color":"#38bdf8"');
  expect(JSON.stringify(result)).toContain('"fontFamily":"Trebuchet MS"');
  expect(JSON.stringify(result)).toContain('"textAlign":null');
});

it("drops unsupported ordinary clipboard styling while preserving words", () => {
  const result = newsContentSchema.parse({
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { textAlign: "justify" },
        content: [
          {
            type: "text",
            text: "Team news",
            marks: [
              {
                type: "textStyle",
                attrs: {
                  color: "#000000",
                  fontFamily: "Calibri",
                  fontSize: "11pt",
                },
              },
            ],
          },
        ],
      },
    ],
  });
  expect(newsPlainText(result)).toBe("Team news");
  expect(JSON.stringify(result)).not.toContain("Calibri");
});
