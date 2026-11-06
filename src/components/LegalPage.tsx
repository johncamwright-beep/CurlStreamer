import Link from "next/link";
import type { ReactNode } from "react";

export function LegalPage({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto max-w-3xl px-5 py-10 text-slate-200">
      <Link
        href="/"
        className="inline-flex min-h-11 items-center text-cyan-300"
      >
        ← CurlStreamer
      </Link>
      <h1 className="mt-5 text-3xl font-bold text-white">{title}</h1>
      <p className="mt-2 text-sm text-slate-400">
        Last updated October 6, 2026
      </p>
      <div className="mt-8 grid gap-7 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-white [&_p]:leading-7 [&_p+p]:mt-3 [&_a]:text-cyan-300 [&_a]:underline [&_li]:my-2 [&_ul]:list-disc [&_ul]:pl-6">
        {children}
      </div>
      <nav
        aria-label="Legal pages"
        className="mt-10 flex flex-wrap gap-5 border-t border-slate-700 pt-5"
      >
        <Link
          className="inline-flex min-h-11 items-center text-cyan-300"
          href="/privacy"
        >
          Privacy Policy
        </Link>
        <Link
          className="inline-flex min-h-11 items-center text-cyan-300"
          href="/terms"
        >
          Terms of Service
        </Link>
        <a
          className="inline-flex min-h-11 items-center text-cyan-300"
          href="mailto:hello@curlstreamer.app"
        >
          Contact support
        </a>
      </nav>
    </main>
  );
}
