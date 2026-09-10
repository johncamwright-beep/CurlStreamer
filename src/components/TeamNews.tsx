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
