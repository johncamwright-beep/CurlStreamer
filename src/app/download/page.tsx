import Link from "next/link";
import type { Metadata } from "next";
import { formatBytes, studioRelease } from "@/lib/studio-release";

export const metadata: Metadata = {
  title: "Download CurlStreamer Studio",
  description: "Install CurlStreamer Studio for the Windows x64 pilot.",
  robots: { index: false, follow: false },
};

export default function DownloadPage() {
  const installer =
    studioRelease.availability === "published" ? studioRelease.installer : null;

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-10 sm:px-6">
      <Link className="inline-flex min-h-11 items-center underline" href="/">
        Back to CurlStreamer
      </Link>
      <header className="mt-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-cyan-300">
          Windows Studio pilot
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">
          Download CurlStreamer Studio
        </h1>
        <p className="mt-3 text-slate-300">
          CurlStreamer Studio records and starts broadcasts from the Windows
          recording PC. This pilot release supports Windows x64.
        </p>
      </header>

      <section className="panel mt-8" aria-labelledby="release-heading">
        <h2 id="release-heading" className="text-xl font-bold">
          {installer ? `Studio ${studioRelease.version}` : "Release pending"}
        </h2>
        {installer ? (
          <>
            <p className="mt-3 text-slate-300">
              Unsigned pilot installer for {studioRelease.platform}{" "}
              {studioRelease.architecture}. Windows may display an
              unknown-publisher warning.
            </p>
            <a
              className="btn mt-4 inline-flex min-h-11 items-center"
              href={installer.url}
            >
              Download {installer.fileName}
            </a>
            <p className="mt-3 text-sm">
              <a
                className="inline-flex min-h-11 items-center underline"
                href={
                  "https://github.com/johncamwright-beep/CurlStreamer/releases/tag/studio-v" +
                  studioRelease.version
                }
              >
                Release notes, source and notices
              </a>
            </p>
            <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-[9rem_1fr]">
              <dt className="font-semibold text-slate-200">Version</dt>
              <dd>{studioRelease.version}</dd>
              <dt className="font-semibold text-slate-200">Size</dt>
              <dd>{formatBytes(installer.sizeBytes)}</dd>
              <dt className="font-semibold text-slate-200">SHA-256</dt>
              <dd className="break-all font-mono text-xs">
                {installer.sha256}
              </dd>
            </dl>
          </>
        ) : (
          <p className="mt-3 text-slate-300" role="status">
            The {studioRelease.version} Windows x64 pilot installer has not been
            published yet. Check back here when your CurlStreamer contact
            confirms the release.
          </p>
        )}
      </section>

      <section className="panel mt-6" aria-labelledby="install-heading">
        <h2 id="install-heading" className="text-xl font-bold">
          Install or update Studio
        </h2>
        <ol className="mt-4 list-decimal space-y-3 pl-5 text-slate-200">
          <li>Save the Windows x64 installer to the recording PC.</li>
          <li>
            Close CurlStreamer Studio before installing or updating it. This
            keeps the application files available to the installer.
          </li>
          <li>Run the installer and follow the Windows prompts.</li>
          <li>
            Open CurlStreamer Studio from the Start menu, then open the game
            link from CurlStreamer.
          </li>
        </ol>
        <p className="mt-4 text-sm text-slate-300">
          Existing recordings are preserved when Studio is updated. Do not
          uninstall Studio or remove its recording folder as part of a normal
          update.
        </p>
      </section>

      <section className="panel mt-6" aria-labelledby="requirements-heading">
        <h2 id="requirements-heading" className="text-xl font-bold">
          Before you install
        </h2>
        <p className="mt-3 text-slate-300">
          Use Windows 10 (1809 or later) or Windows 11 on an x64 PC with .NET
          Framework 4.8 or later. Studio also requires Microsoft Edge WebView2
          Runtime. Most current Windows PCs already include it. If Studio
          reports that WebView2 is missing, install{" "}
          <a
            className="underline"
            href="https://developer.microsoft.com/microsoft-edge/webview2/"
          >
            Microsoft&apos;s WebView2 Runtime
          </a>
          , then reopen Studio.
        </p>
      </section>
    </main>
  );
}
