"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { newsPostTitle } from "@/lib/news-content";
type Post = {
  id: string;
  summary: string;
  content: unknown;
  created_at: string;
  published: boolean;
};
export function TeamNews() {
  const [saved, setSaved] = useState<string | null>(null);
  const [publication, setPublication] = useState<{
    published: boolean;
    news: boolean;
    slug: string;
  } | null>(null);
  const [posts, setPosts] = useState<Post[]>([]),
    [ready, setReady] = useState(false),
    [message, setMessage] = useState("");
  async function load() {
    try {
      const response = await fetch("/api/account/news", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw Error(body.error);
      setPosts(body.posts);
      setReady(true);
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not load news.",
      );
    }
  }
  useEffect(() => {
    void load();
    setSaved(new URLSearchParams(window.location.search).get("saved"));
    void fetch("/api/account/team", { cache: "no-store" })
      .then(async (response) =>
        response.ok ? (await response.json()).settings : null,
      )
      .then(setPublication)
      .catch(() => setPublication(null));
  }, []);
  return (
    <section className="grid gap-3" aria-label="Manage team news">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">News posts</h2>
        <Link className="btn" href="/account/news/new">
          New post
        </Link>
      </div>
      {message && <p role="status">{message}</p>}
      {saved && (
        <p role="status">
          {saved === "published" ? "Post saved as published." : "Draft saved."}
        </p>
      )}
      {publication &&
        (publication.published && publication.news ? (
          <a
            className="inline-flex min-h-11 items-center text-cyan-300 underline"
            href={`https://${publication.slug}.curlstreamer.app/#team-news`}
            target="_blank"
            rel="noreferrer"
          >
            View news on your team website
          </a>
        ) : (
          <p>
            Your website’s news is hidden.{" "}
            <Link
              className="text-cyan-300 underline"
              href="/account?section=public"
            >
              Open Public team page settings
            </Link>{" "}
            to enable your page and news section.
          </p>
        ))}
      {!ready && (
        <button className="btn-secondary" onClick={() => void load()}>
          Reload news
        </button>
      )}
      {ready && !posts.length && <p>No news posts yet.</p>}
      <div>
        {posts.map((post) => (
          <Link
            key={post.id}
            href={"/account/news/" + post.id}
            className="flex min-h-11 items-center justify-between gap-4 border-t border-slate-700 py-3 hover:text-cyan-300"
          >
            <span className="min-w-0 break-words font-semibold">
              {newsPostTitle(post.content, post.summary)}
            </span>
            <time
              className="shrink-0 text-sm text-slate-400"
              dateTime={post.created_at}
            >
              {new Date(post.created_at).toLocaleDateString()}
            </time>
          </Link>
        ))}
      </div>
    </section>
  );
}
