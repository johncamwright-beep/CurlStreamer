import { z } from "zod";

const textNode = z.object({
  type: z.literal("text"),
  text: z.string().min(1).max(5000),
  marks: z
    .array(
      z.union([
        z.object({ type: z.enum(["bold", "italic"]) }),
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
const imageNode = z.object({
  type: z.literal("image"),
  attrs: z.object({
    src: z
      .string()
      .url()
      .max(2048)
      .refine((url) => /^https:\/\//.test(url), "HTTPS images only"),
    alt: z.string().max(250).default(""),
  }),
});
const inlineNode = z.union([
  textNode,
  imageNode,
  z.object({ type: z.literal("hardBreak") }),
]);
const paragraph = z.object({
  type: z.literal("paragraph"),
  content: z.array(inlineNode).max(200).optional(),
});
const heading = z.object({
  type: z.literal("heading"),
  attrs: z.object({ level: z.union([z.literal(2), z.literal(3)]) }),
  content: z.array(inlineNode).max(200).optional(),
});
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
const node = z.union([paragraph, heading, list, imageNode]);

export const newsContentSchema = z
  .object({ type: z.literal("doc"), content: z.array(node).min(1).max(200) })
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
