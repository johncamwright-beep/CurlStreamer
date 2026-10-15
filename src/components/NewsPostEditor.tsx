"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { NewsContent } from "@/components/NewsContent";
import { NewsRichEditor } from "@/components/NewsRichEditor";
import {
  legacyNewsContent,
  newsContentSchema,
  newsPlainText,
  newsPostTitle,
  type NewsContent as NewsDocument,
} from "@/lib/news-content";
import { optimizeUploadImage } from "@/lib/optimize-upload-image";
type Post = {
  id: string;
  revision: number;
  summary: string;
  content: unknown;
  photo_url: string | null;
  published: boolean;
  created_at: string;
  game_id: string | null;
};
export function NewsPostEditor({ postId }: { postId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [dirty, setDirty] = useState(false);
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [editor, setEditor] = useState<{ id: string; revision: number } | null>(
      null,
    ),
    [content, setContent] = useState<NewsDocument>(legacyNewsContent("")),
    [photo, setPhoto] = useState<File>(),
    [existingPhoto, setExistingPhoto] = useState<string | null>(null),
    [removePhoto, setRemovePhoto] = useState(false),
    [published, setPublished] = useState(false),
    [preview, setPreview] = useState(false),
    [removing, setRemoving] = useState<string | null>(null),
    [inlineUploading, setInlineUploading] = useState(false),
    [coverOptimizing, setCoverOptimizing] = useState(false);
  const lock = useRef(false);
  async function load() {
    try {
      const response = await fetch(
        "/api/account/news" +
          (postId === "new" ? "" : "?id=" + encodeURIComponent(postId)),
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok) throw Error(body.error);
      const post =
        postId === "new"
          ? undefined
          : body.posts.find((item: Post) => item.id === postId);
      if (postId !== "new" && !post)
        throw Error("This post is no longer available.");
      edit(post);
      setReady(true);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not load news.",
      );
    }
  }
  useEffect(() => {
    void load();
  }, [postId]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function edit(post?: Post) {
    setEditor({
      id: post?.id ?? crypto.randomUUID(),
      revision: post?.revision ?? 0,
    });
    const parsed = newsContentSchema.safeParse(post?.content);
    setContent(
      parsed.success ? parsed.data : legacyNewsContent(post?.summary ?? ""),
    );
    setTitle(post ? newsPostTitle(post.content, post.summary) : "");
    setDirty(false);
    setPhoto(undefined);
    setExistingPhoto(post?.photo_url ?? null);
    setRemovePhoto(false);
    setPublished(post?.published ?? false);
    setPreview(false);
    setMessage("");
    setRemoving(null);
  }
  async function save(publish: boolean) {
    if (!editor || lock.current || inlineUploading || coverOptimizing) return;
    const summary = newsPlainText(content);
    if (!summary || !title.trim()) {
      setMessage("Add a title and some text before saving this post.");
      return;
    }
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      const form = new FormData();
      form.append("id", editor.id);
      form.append("revision", String(editor.revision));
      form.append("summary", summary);
      form.append(
        "content",
        JSON.stringify({ ...content, title: title.trim() }),
      );
      form.append("published", String(publish));
      form.append("removePhoto", String(removePhoto));
      if (photo) form.append("photo", photo);
      const response = await fetch("/api/account/news", {
        method: editor.revision ? "PATCH" : "POST",
        body: form,
      });
      const body = await response.json();
      if (!response.ok) throw Error(body.error);
      setDirty(false);
      setMessage(
        publish
          ? "News saved. It appears publicly when your team page and news section are enabled."
          : "Draft saved. It is hidden from your public team page.",
      );
      router.push(
        "/account?section=news&saved=" + (publish ? "published" : "draft"),
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save news.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function chooseCoverPhoto(file?: File) {
    if (!file) return;
    if (
      !/^image\/(png|jpeg|webp)$/.test(file.type) ||
      file.size > 20 * 1024 * 1024
    ) {
      setMessage("Choose a PNG, JPEG or WebP cover photo up to 20 MB.");
      return;
    }
    setCoverOptimizing(true);
    setMessage("");
    try {
      setPhoto(await optimizeUploadImage(file, { aspectRatio: 16 / 9 }));
      setDirty(true);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Cover photo optimization failed. Please try again.",
      );
    } finally {
      setCoverOptimizing(false);
    }
  }
  async function remove(post: Post) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const response = await fetch("/api/account/news", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: post.id, revision: post.revision }),
      });
      const body = await response.json();
      if (!response.ok) throw Error(body.error);
      setRemoving(null);
      setMessage("Post removed from team news.");
      setDirty(false);
      router.push("/account?section=news");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not remove post.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="news-post-page panel grid gap-3"
      aria-label="Manage team news"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-black">
          {postId === "new" ? "New post" : "Edit post"}
        </h1>
        <Link
          className="btn-secondary"
          href="/account?section=news"
          onClick={(e) => {
            if (dirty && !window.confirm("Leave without saving your changes?"))
              e.preventDefault();
          }}
        >
          Back to news posts
        </Link>
      </div>
      {message && <p role="status">{message}</p>}
      {!ready && (
        <button className="btn-secondary" onClick={() => void load()}>
          Reload post
        </button>
      )}
      {editor && (
        <fieldset
          disabled={busy || inlineUploading || coverOptimizing}
          className="grid gap-4"
          onChange={() => setDirty(true)}
        >
          <legend>
            {editor.revision ? "Edit news post" : "New news post"}
          </legend>
          <label className="grid gap-2 font-bold">
            Post title
            <input
              className="input w-full text-xl"
              maxLength={160}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setDirty(true);
              }}
              placeholder="Give your post a title"
            />
          </label>
          <div>
            News text
            <NewsRichEditor
              key={editor.id}
              initialContent={content}
              onChange={(value) => {
                setContent(value);
                setDirty(true);
              }}
              onUploadingChange={setInlineUploading}
              disabled={busy}
            />
          </div>
          <button
            type="button"
            className="btn-secondary w-fit"
            onClick={() => setPreview(!preview)}
          >
            {preview ? "Edit" : "Preview"}
          </button>
          {preview && (
            <div
              className="rounded-lg border border-slate-700 p-3"
              aria-label="News preview"
            >
              <h2 className="text-2xl font-bold">{title}</h2>
              <NewsContent content={content} summary={newsPlainText(content)} />
            </div>
          )}
          {existingPhoto && !removePhoto && (
            <img
              src={existingPhoto}
              alt="Current post photo"
              className="max-h-40 w-full object-contain"
            />
          )}
          {existingPhoto && (
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                checked={removePhoto}
                onChange={(e) => setRemovePhoto(e.target.checked)}
              />
              Remove current cover photo
            </label>
          )}
          <label>
            Cover photo (optional)
            <input
              key={editor.id + ":" + editor.revision}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="mt-2 block min-h-11 w-full"
              onChange={(e) => void chooseCoverPhoto(e.target.files?.[0])}
            />
          </label>
          <p>
            {published ? "Published post" : "Draft post"}. Save and publish
            makes your changes public when your team page and news section are
            enabled.
          </p>
          {message && (
            <p
              role="alert"
              className="rounded-lg border border-amber-500/50 p-3 text-amber-200"
            >
              {message}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              className="btn"
              disabled={
                inlineUploading ||
                coverOptimizing ||
                !newsPlainText(content) ||
                !title.trim()
              }
              onClick={() => void save(true)}
            >
              {busy ? "Saving…" : "Save and publish"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={
                inlineUploading ||
                coverOptimizing ||
                !newsPlainText(content) ||
                !title.trim()
              }
              onClick={() => void save(false)}
            >
              Save draft
            </button>
            <button
              className="btn-secondary"
              disabled={inlineUploading || coverOptimizing}
              onClick={() => {
                if (
                  !dirty ||
                  window.confirm("Leave without saving your changes?")
                )
                  router.push("/account?section=news");
              }}
            >
              Cancel
            </button>
          </div>
        </fieldset>
      )}
      {editor?.revision ? (
        <div className="border-t border-slate-700 pt-4">
          <button
            className="btn-secondary"
            disabled={busy || inlineUploading}
            onClick={() => setRemoving(editor.id)}
          >
            Remove post
          </button>
          {removing && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span>Remove this post from team news?</span>
              <button
                className="btn-secondary"
                disabled={busy || inlineUploading}
                onClick={() =>
                  void remove({
                    id: editor.id,
                    revision: editor.revision,
                  } as Post)
                }
              >
                Confirm removal
              </button>
              <button
                className="btn-secondary"
                onClick={() => setRemoving(null)}
              >
                Keep post
              </button>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
