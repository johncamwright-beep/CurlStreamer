import React, { type ReactNode } from "react";
import {
  legacyNewsContent,
  newsContentSchema,
  type NewsContent,
} from "@/lib/news-content";

type InlineNode =
  | { type: "hardBreak" }
  | { type: "image"; attrs: { src: string; alt: string } }
  | {
      type: "text";
      text: string;
      marks?: Array<
        { type: "bold" | "italic" } | { type: "link"; attrs: { href: string } }
      >;
    };
function inline(nodes: InlineNode[] | undefined): ReactNode[] {
  return (nodes ?? []).map((node, index) => {
    if (node.type === "hardBreak") return <br key={index} />;
    if (node.type === "image")
      return (
        <img
          key={index}
          src={node.attrs.src}
          alt={node.attrs.alt}
          className="my-3 max-h-96 w-full object-contain"
        />
      );
    let value: ReactNode = node.text;
    for (const mark of node.marks ?? []) {
      if (mark.type === "bold")
        value = <strong key={`b-${index}`}>{value}</strong>;
      if (mark.type === "italic") value = <em key={`i-${index}`}>{value}</em>;
      if (mark.type === "link")
        value = (
          <a
            key={`a-${index}`}
            href={mark.attrs.href}
            className="text-cyan-300 underline"
            target="_blank"
            rel="noreferrer"
          >
            {value}
          </a>
        );
    }
    return <span key={index}>{value}</span>;
  });
}

export function NewsContent({
  content,
  summary,
}: {
  content: unknown;
  summary: string;
}) {
  const parsed = newsContentSchema.safeParse(content);
  const document = parsed.success ? parsed.data : legacyNewsContent(summary);
  return (
    <div className="mt-3 break-words">
      {document.content.map(function renderBlock(
        block: NewsContent["content"][number],
        index: number,
      ): ReactNode {
        if (block.type === "image")
          return (
            <img
              key={index}
              src={block.attrs.src}
              alt={block.attrs.alt}
              className="my-3 max-h-96 w-full object-contain"
            />
          );
        if (block.type === "heading")
          return block.attrs.level === 2 ? (
            <h2 key={index} className="my-3 text-xl font-bold">
              {inline(block.content)}
            </h2>
          ) : (
            <h3 key={index} className="my-3 text-lg font-bold">
              {inline(block.content)}
            </h3>
          );
        if (block.type === "bulletList" || block.type === "orderedList") {
          const List = block.type === "bulletList" ? "ul" : "ol";
          return (
            <List
              key={index}
              className={
                block.type === "bulletList"
                  ? "my-3 list-disc pl-6"
                  : "my-3 list-decimal pl-6"
              }
            >
              {block.content.map((item, itemIndex) => (
                <li key={itemIndex}>
                  {item.content.map((child, childIndex) =>
                    renderBlock(child, childIndex),
                  )}
                </li>
              ))}
            </List>
          );
        }
        return block.type === "paragraph" ? (
          <p key={index} className="my-3 whitespace-pre-wrap">
            {inline(block.content)}
          </p>
        ) : null;
      })}
    </div>
  );
}
