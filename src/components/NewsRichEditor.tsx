"use client";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { useEffect, useRef, useState } from "react";
import {
  legacyNewsContent,
  newsContentSchema,
  type NewsContent,
} from "@/lib/news-content";
import "./news-editor.css";

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
  const initial = newsContentSchema.safeParse(initialContent);
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: false,
        underline: false,
        blockquote: false,
        codeBlock: false,
        code: false,
        strike: false,
        horizontalRule: false,
      }),
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
      file.size > 4 * 1024 * 1024
    ) {
      setError("Choose a PNG, JPEG or WebP photo up to 4 MB.");
      return;
    }
    setUploading(true);
    onUploadingChange?.(true);
    try {
      const form = new FormData();
      form.append("image", file);
      const response = await fetch("/api/account/news/upload", {
        method: "POST",
        body: form,
      });
      const body = await response.json();
      if (!response.ok) throw Error(body.error);
      editor
        .chain()
        .focus()
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
  ];
  return (
    <div className="news-composer">
      <div
        className="news-toolbar"
        role="group"
        aria-label="News formatting"
        onMouseDown={(event) => event.preventDefault()}
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
          disabled={locked}
          aria-expanded={panel === "photo"}
          onClick={() => {
            setPanel(panel === "photo" ? null : "photo");
            setError("");
          }}
        >
          Add photo
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
        WebP, up to 4 MB each. Uploaded photos have public links, including in
        drafts.
      </p>
    </div>
  );
}
