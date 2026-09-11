"use client";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { Extension, Mark } from "@tiptap/core";
import { useEffect, useRef, useState } from "react";
import {
  legacyNewsContent,
  newsFontFamilies,
  newsFontSizes,
  newsTextColors,
  newsContentSchema,
  type NewsContent,
} from "@/lib/news-content";
import { optimizeUploadImage } from "@/lib/optimize-upload-image";
import "./news-editor.css";

const TextStyle = Mark.create({
  name: "textStyle",
  addAttributes() {
    return {
      color: { default: null, parseHTML: (element) => element.style.color },
      fontFamily: {
        default: null,
        parseHTML: (element) => element.style.fontFamily,
      },
      fontSize: {
        default: null,
        parseHTML: (element) => element.style.fontSize,
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[style]" }];
  },
  renderHTML({ HTMLAttributes }) {
    const { color, fontFamily, fontSize } = HTMLAttributes;
    const style = [
      color && `color: ${color}`,
      fontFamily && `font-family: ${fontFamily}`,
      fontSize && `font-size: ${fontSize}`,
    ]
      .filter(Boolean)
      .join("; ");
    return ["span", style ? { style } : {}, 0];
  },
});

const TextAlignment = Extension.create({
  name: "newsTextAlignment",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading", "blockquote"],
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (element) => element.style.textAlign,
            renderHTML: (attributes) =>
              attributes.textAlign
                ? { style: `text-align: ${attributes.textAlign}` }
                : {},
          },
        },
      },
    ];
  },
});

export function NewsRichEditor({
  initialContent,
  onChange,
  disabled,
  onUploadingChange,
}: {
  initialContent: unknown;
  onChange: (content: NewsContent) => void;
  disabled?: boolean;
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [panel, setPanel] = useState<"link" | "photo" | null>(null);
  const [href, setHref] = useState("");
  const [alt, setAlt] = useState("");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const imagePosition = useRef<number | null>(null);
  const initial = newsContentSchema.safeParse(initialContent);
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: false,
        codeBlock: false,
        code: false,
      }),
      TextStyle,
      TextAlignment,
      Link.configure({
        openOnClick: false,
        autolink: false,
        linkOnPaste: false,
      }),
      Image.configure({ inline: false, allowBase64: false }),
    ],
    content: initial.success ? initial.data : legacyNewsContent(""),
    onUpdate: ({ editor }) => onChange(editor.getJSON() as NewsContent),
    editorProps: {
      attributes: {
        class: "news-writing-surface",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "News text",
      },
    },
  });
  useEffect(() => {
    editor?.setEditable(!disabled && !uploading);
  }, [editor, disabled, uploading]);
  if (!editor) return <p className="text-sm text-slate-400">Loading editor…</p>;
  const locked = !!disabled || uploading;
  async function upload(file: File) {
    if (!editor || locked) return;
    setError("");
    if (
      !/^image\/(png|jpeg|webp)$/.test(file.type) ||
      file.size > 20 * 1024 * 1024
    ) {
      setError("Choose a PNG, JPEG or WebP photo up to 20 MB.");
      return;
    }
    setUploading(true);
    onUploadingChange?.(true);
    try {
      const optimized = await optimizeUploadImage(file, {
        aspectRatio: 16 / 9,
      });
      const form = new FormData();
      form.append("image", optimized);
      const response = await fetch("/api/account/news/upload", {
        method: "POST",
        body: form,
      });
      const body = await response.json();
      if (!response.ok) throw Error(body.error);
      editor
        .chain()
        .focus()
        .setTextSelection(imagePosition.current ?? editor.state.selection.from)
        .setImage({ src: body.url, alt })
        .createParagraphNear()
        .run();
      setPanel(null);
      setAlt("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Photo upload failed. Please try again.",
      );
    } finally {
      setUploading(false);
      onUploadingChange?.(false);
      if (input.current) input.current.value = "";
    }
  }
  function applyLink() {
    if (!editor) return;
    try {
      const url = new URL(href.trim());
      if (url.protocol !== "https:" || url.username || url.password)
        throw Error();
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: url.href })
        .run();
      setPanel(null);
      setError("");
    } catch {
      setError("Enter a complete HTTPS link, such as https://example.com.");
    }
  }
  const actions = [
    {
      label: "Bold",
      active: editor.isActive("bold"),
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: "Italic",
      active: editor.isActive("italic"),
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: "Underline",
      active: editor.isActive("underline"),
      run: () => editor.chain().focus().toggleUnderline().run(),
    },
    {
      label: "Strike through",
      active: editor.isActive("strike"),
      run: () => editor.chain().focus().toggleStrike().run(),
    },
    {
      label: "Heading",
      active: editor.isActive("heading"),
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: "Bullets",
      active: editor.isActive("bulletList"),
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: "Numbered list",
      active: editor.isActive("orderedList"),
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "Quote",
      active: editor.isActive("blockquote"),
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      label: "Divider",
      active: false,
      run: () => editor.chain().focus().setHorizontalRule().run(),
    },
  ];
  return (
    <div className="news-composer">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-700 p-3">
        <button
          type="button"
          className="btn-secondary"
          disabled={locked}
          aria-expanded={panel === "photo"}
          onClick={() => {
            imagePosition.current = editor.state.selection.from;
            setPanel(panel === "photo" ? null : "photo");
            setError("");
          }}
        >
          Insert image in post
        </button>
        <span className="text-sm text-slate-300">
          Place the cursor in your text, then insert an image there.
        </span>
      </div>
      <div
        className="news-toolbar"
        role="group"
        aria-label="News formatting"
        onMouseDown={(event) => {
          if ((event.target as HTMLElement).closest("button"))
            event.preventDefault();
        }}
      >
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            disabled={locked}
            aria-pressed={action.active}
            onClick={action.run}
          >
            {action.label}
          </button>
        ))}
        <label className="news-toolbar-select">
          <span className="sr-only">Font family</span>
          <select
            aria-label="Font family"
            disabled={locked}
            value={editor.getAttributes("textStyle").fontFamily ?? ""}
            onChange={(event) =>
              editor
                .chain()
                .focus()
                .setMark("textStyle", {
                  fontFamily: event.target.value || null,
                })
                .run()
            }
          >
            <option value="">Font</option>
            {newsFontFamilies.map((family) => (
              <option key={family} value={family}>
                {family}
              </option>
            ))}
          </select>
        </label>
        <label className="news-toolbar-select">
          <span className="sr-only">Font size</span>
          <select
            aria-label="Font size"
            disabled={locked}
            value={editor.getAttributes("textStyle").fontSize ?? ""}
            onChange={(event) =>
              editor
                .chain()
                .focus()
                .setMark("textStyle", { fontSize: event.target.value || null })
                .run()
            }
          >
            <option value="">Size</option>
            {newsFontSizes.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <label className="news-toolbar-select">
          <span className="sr-only">Text color</span>
          <select
            aria-label="Text color"
            disabled={locked}
            value={editor.getAttributes("textStyle").color ?? ""}
            onChange={(event) =>
              editor
                .chain()
                .focus()
                .setMark("textStyle", { color: event.target.value || null })
                .run()
            }
          >
            <option value="">Color</option>
            {newsTextColors.map((color) => (
              <option key={color} value={color}>
                {
                  {
                    "#f8fafc": "White",
                    "#f87171": "Coral",
                    "#fbbf24": "Gold",
                    "#4ade80": "Green",
                    "#38bdf8": "Blue",
                    "#c084fc": "Purple",
                  }[color]
                }
              </option>
            ))}
          </select>
        </label>
        {(["left", "center", "right"] as const).map((alignment) => (
          <button
            key={alignment}
            type="button"
            disabled={locked}
            aria-pressed={editor.isActive({ textAlign: alignment })}
            onClick={() =>
              editor
                .chain()
                .focus()
                .updateAttributes(
                  editor.isActive("heading")
                    ? "heading"
                    : editor.isActive("blockquote")
                      ? "blockquote"
                      : "paragraph",
                  { textAlign: alignment },
                )
                .run()
            }
          >
            Align {alignment}
          </button>
        ))}
        <button
          type="button"
          disabled={locked}
          onClick={() =>
            editor.chain().focus().unsetAllMarks().clearNodes().run()
          }
        >
          Clear formatting
        </button>
        <button
          type="button"
          disabled={locked}
          aria-expanded={panel === "link"}
          onClick={() => {
            setPanel(panel === "link" ? null : "link");
            setHref(editor.getAttributes("link").href ?? "");
            setError("");
          }}
        >
          Link
        </button>
        <button
          type="button"
          disabled={locked || !editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
        >
          Undo
        </button>
        <button
          type="button"
          disabled={locked || !editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()}
        >
          Redo
        </button>
      </div>
      {panel === "link" && (
        <div className="news-insert-panel">
          <label className="grid flex-1 gap-1">
            Link address
            <input
              className="input w-full"
              type="url"
              value={href}
              onChange={(event) => setHref(event.target.value)}
              placeholder="https://example.com"
              disabled={locked}
            />
          </label>
          <button
            type="button"
            className="btn-secondary"
            onClick={applyLink}
            disabled={locked || !href.trim()}
          >
            Apply link
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={locked || !editor.isActive("link")}
            onClick={() => {
              editor.chain().focus().unsetLink().run();
              setPanel(null);
            }}
          >
            Remove link
          </button>
        </div>
      )}
      {panel === "photo" && (
        <div className="news-insert-panel">
          <label className="grid flex-1 gap-1">
            Photo description
            <input
              className="input w-full"
              maxLength={250}
              value={alt}
              onChange={(event) => setAlt(event.target.value)}
              placeholder="Describe the photo for screen readers"
              disabled={locked}
            />
          </label>
          <button
            type="button"
            className="btn-secondary"
            disabled={locked}
            onClick={() => input.current?.click()}
          >
            Choose photo
          </button>
        </div>
      )}
      <input
        ref={input}
        type="file"
        aria-label="Inline photo"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        disabled={locked}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      {error && (
        <p role="alert" className="px-4 py-2 text-red-300">
          {error}
        </p>
      )}
      {uploading && (
        <p role="status" className="px-4 py-2 text-cyan-200">
          Uploading photo…
        </p>
      )}
      <EditorContent editor={editor} />
      <p className="news-editor-hint">
        Write your update here. Insert photos between paragraphs. PNG, JPEG or
        WebP, up to 20 MB each. Photos are converted to JPEG and reduced to 300
        KB before upload. Uploaded photos have public links, including in
        drafts.
      </p>
    </div>
  );
}
