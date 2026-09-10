"use client";
import { useEffect, useRef, useState } from "react";
import { NewsContent } from "@/components/NewsContent";
import { NewsRichEditor } from "@/components/NewsRichEditor";
import {
  legacyNewsContent,
  newsContentSchema,
  newsPlainText,
  type NewsContent as NewsDocument,
} from "@/lib/news-content";
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
export function TeamNews() {
  const [posts, setPosts] = useState<Post[]>([]),
    [ready, setReady] = useState(false),
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
    [inlineUploading, setInlineUploading] = useState(false);
  const lock = useRef(false);
  async function load() {
    try {
      const response = await fetch("/api/account/news", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw Error(body.error);
      setPosts(body.posts);
      setReady(true);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not load news.",
      );
    }
  }
  useEffect(() => {
    void load();
  }, []);
  function edit(post?: Post) {
    setEditor({
      id: post?.id ?? crypto.randomUUID(),
      revision: post?.revision ?? 0,
    });
    const parsed = newsContentSchema.safeParse(post?.content);
    setContent(
      parsed.success ? parsed.data : legacyNewsContent(post?.summary ?? ""),
    );
    setPhoto(undefined);
    setExistingPhoto(post?.photo_url ?? null);
    setRemovePhoto(false);
    setPublished(post?.published ?? false);
    setPreview(false);
    setMessage("");
    setRemoving(null);
  }
  async function save() {
    if (!editor || lock.current || inlineUploading) return;
    const summary = newsPlainText(content);
    if (!summary) {
      setMessage("Add some text before saving this post.");
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
      form.append("content", JSON.stringify(content));
      form.append("published", String(published));
      form.append("removePhoto", String(removePhoto));
      if (photo) form.append("photo", photo);
      const response = await fetch("/api/account/news", {
        method: editor.revision ? "PATCH" : "POST",
        body: form,
      });
      const body = await response.json();
      if (!response.ok) throw Error(body.error);
      setEditor(null);
      setMessage(
        published
          ? "News saved. It appears publicly when your team page and news section are enabled."
          : "Draft saved. It is hidden from your public team page.",
      );
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save news.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
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
      await load();
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
    <section className="panel grid gap-3" aria-label="Manage team news">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">Team news</h2>
        <div className="flex gap-2">
          <button
            className="btn-secondary"
            disabled={busy || inlineUploading}
            onClick={() => void load()}
          >
            Reload news
          </button>
          <button
            className="btn"
            disabled={!ready || busy || inlineUploading}
            onClick={() => edit()}
          >
            New post
          </button>
        </div>
      </div>
      <p className="text-sm text-slate-400">
        Write team updates, thank sponsors, or manage game summaries. Posts
        appear newest first.
      </p>
      {message && <p role="status">{message}</p>}
      {editor && (
        <fieldset
          disabled={busy || inlineUploading}
          className="grid gap-3 rounded-lg border border-slate-600 p-3"
        >
          <legend>
            {editor.revision ? "Edit news post" : "New news post"}
          </legend>
          <div>
            News text
            <NewsRichEditor
              key={editor.id}
              initialContent={content}
              onChange={setContent}
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
              onChange={(e) => setPhoto(e.target.files?.[0])}
            />
          </label>
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              checked={published}
              onChange={(e) => setPublished(e.target.checked)}
            />
            Publish this post
          </label>
          <div className="flex gap-3">
            <button
              className="btn"
              disabled={inlineUploading || !newsPlainText(content)}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : published ? "Save and publish" : "Save draft"}
            </button>
            <button
              className="btn-secondary"
              disabled={inlineUploading}
              onClick={() => setEditor(null)}
            >
              Cancel
            </button>
          </div>
        </fieldset>
      )}
      {ready && !posts.length && <p>No news posts yet.</p>}
      {!editor &&
        posts.map((post) => (
          <article
            key={post.id}
            className="grid gap-2 border-t border-slate-700 py-3"
          >
            <div className="flex flex-wrap justify-between gap-2">
              <span>
                {post.published ? "Published" : "Draft"}
                {post.game_id ? " · Game summary" : ""}
              </span>
              <time className="text-sm text-slate-400">
                {new Date(post.created_at).toLocaleDateString()}
              </time>
            </div>
            <NewsContent content={post.content} summary={post.summary} />
            {post.photo_url && (
              <img
                src={post.photo_url}
                alt="Post photo"
                className="max-h-32 w-full object-contain"
              />
            )}
            <div className="flex flex-wrap gap-2">
              <button
                className="btn-secondary"
                disabled={busy || inlineUploading}
                onClick={() => edit(post)}
              >
                Edit post
              </button>
              <button
                className="btn-secondary"
                disabled={busy || inlineUploading}
                onClick={() => setRemoving(post.id)}
              >
                Remove post
              </button>
            </div>
            {removing === post.id && (
              <div className="flex flex-wrap items-center gap-3">
                <span>Remove this post from team news?</span>
                <button
                  className="btn-secondary"
                  disabled={busy || inlineUploading}
                  onClick={() => void remove(post)}
                >
                  Confirm removal
                </button>
                <button
                  className="btn-secondary"
                  disabled={busy || inlineUploading}
                  onClick={() => setRemoving(null)}
                >
                  Keep post
                </button>
              </div>
            )}
          </article>
        ))}
    </section>
  );
}
