import { z } from "zod";

export const newsFontFamilies = [
  "Arial",
  "Georgia",
  "Trebuchet MS",
  "Verdana",
  "Courier New",
] as const;
export const newsFontSizes = ["14px", "16px", "18px", "20px", "24px"] as const;
export const newsTextColors = [
  "#f8fafc",
  "#f87171",
  "#fbbf24",
  "#4ade80",
  "#38bdf8",
  "#c084fc",
] as const;

// Clipboard HTML uses empty CSS values and browser-normalized RGB colours.
// Keep supported presentation values; discard other styling, never the text.
function pastedStyle<const T extends readonly [string, ...string[]]>(
  values: T,
) {
  return z.preprocess((value) => {
    if (typeof value !== "string") return value;
    let normalized = value.trim().replace(/^["']|["']$/g, "");
    const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(normalized);
    if (rgb)
      normalized =
        "#" +
        rgb
          .slice(1)
          .map((v) => Number(v).toString(16).padStart(2, "0"))
          .join("");
    if (!/^[\w\s#.%,-]*$/.test(normalized)) return value;
    return (
      values.find((v) => v.toLowerCase() === normalized.toLowerCase()) ?? null
    );
  }, z.enum(values).nullish());
}
const textAlignment = pastedStyle(["left", "center", "right"]);
const textStyleMark = z.object({
  type: z.literal("textStyle"),
  attrs: z.object({
    color: pastedStyle(newsTextColors),
    fontFamily: pastedStyle(newsFontFamilies),
    fontSize: pastedStyle(newsFontSizes),
  }),
});
const textNode = z.object({
  type: z.literal("text"),
  text: z.string().min(1).max(5000),
  marks: z
    .array(
      z.union([
        z.object({ type: z.enum(["bold", "italic", "underline", "strike"]) }),
        textStyleMark,
        z.object({
          type: z.literal("link"),
          attrs: z.object({
            href: z
              .string()
              .url()
              .max(2048)
              .refine((url) => /^https:\/\//.test(url), "HTTPS links only"),
          }),
        }),
      ]),
    )
    .max(8)
    .optional(),
});
const textAlignmentAttrs = z
  .object({ textAlign: textAlignment.nullish() })
  .optional();
const imageNode = z.object({
  type: z.literal("image"),
  attrs: z.object({
    src: z
      .string()
      .url()
      .max(2048)
      .refine((url) => /^https:\/\//.test(url), "HTTPS images only"),
    alt: z.preprocess((value) => value ?? "", z.string().max(250)),
  }),
});
const inlineNode = z.union([
  textNode,
  imageNode,
  z.object({ type: z.literal("hardBreak") }),
]);
const paragraph = z.object({
  type: z.literal("paragraph"),
  attrs: textAlignmentAttrs,
  content: z.array(inlineNode).max(200).optional(),
});
const heading = z.object({
  type: z.literal("heading"),
  attrs: z.object({
    level: z.union([z.literal(2), z.literal(3)]),
    textAlign: textAlignment.nullish(),
  }),
  content: z.array(inlineNode).max(200).optional(),
});
const blockquote = z.object({
  type: z.literal("blockquote"),
  attrs: textAlignmentAttrs,
  content: z
    .array(z.union([paragraph, heading, imageNode]))
    .min(1)
    .max(100),
});
const horizontalRule = z.object({ type: z.literal("horizontalRule") });
const flatListItem = z.object({
  type: z.literal("listItem"),
  content: z
    .array(z.union([paragraph, heading, imageNode]))
    .min(1)
    .max(20),
});
const nestedList = z.object({
  type: z.enum(["bulletList", "orderedList"]),
  content: z.array(flatListItem).min(1).max(100),
});
const listItem = z.object({
  type: z.literal("listItem"),
  content: z
    .array(z.union([paragraph, heading, imageNode, nestedList]))
    .min(1)
    .max(20),
});
const list = z.object({
  type: z.enum(["bulletList", "orderedList"]),
  content: z.array(listItem).min(1).max(100),
});
const node = z.union([
  paragraph,
  heading,
  list,
  blockquote,
  horizontalRule,
  imageNode,
]);

export const newsContentSchema = z
  .object({
    type: z.literal("doc"),
    title: z.string().trim().max(160).optional(),
    content: z.array(node).min(1).max(200),
  })
  .superRefine((value, context) => {
    if (JSON.stringify(value).length > 40000)
      context.addIssue({
        code: "custom",
        message: "News content is too long.",
      });
  });

export type NewsContent = z.infer<typeof newsContentSchema>;

export function legacyNewsContent(summary: string): NewsContent {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: summary ? [{ type: "text", text: summary }] : undefined,
      },
    ],
  };
}

export function newsPlainText(content: NewsContent) {
  function text(node: {
    type: string;
    text?: string;
    content?: unknown[];
  }): string {
    if (node.type === "text") return node.text ?? "";
    if (node.type === "hardBreak") return "\n";
    return (node.content ?? [])
      .map((child) => text(child as Parameters<typeof text>[0]))
      .join(["paragraph", "heading"].includes(node.type) ? "" : "\n");
  }
  return text(content).trim().slice(0, 3000);
}

export function newsPostTitle(content: unknown, summary: string) {
  const parsed = newsContentSchema.safeParse(content);
  const title = parsed.success ? parsed.data.title?.trim() : "";
  if (title) return title;
  const source = parsed.success ? newsPlainText(parsed.data) : summary;
  const firstLine = source
    .split(/\r?\n/)
    .find((line) => line.trim())
    ?.trim();
  return firstLine ? firstLine.slice(0, 120) : "Untitled post";
}
