export function WindowsStudioRequired({ gameId }: { gameId: string }) {
  return (
    <section
      className="scoring-card"
      aria-labelledby="windows-studio-required-heading"
    >
      <div className="scoring-section-heading">
        <h2 id="windows-studio-required-heading">Requires Windows Studio</h2>
        <span className="scoring-eyebrow">Streaming</span>
      </div>
      <p className="text-sm text-slate-300">
        Starting a YouTube stream happens in CurlStreamer Studio on the Windows
        recording PC. You can keep scoring and managing sponsors in this
        browser.
      </p>
      <p className="mt-3 text-sm text-slate-300">
        Install CurlStreamer Studio on that PC, then connect the PC and camera
        phones to the same travel router. Keep client isolation off and give the
        PC internet access for YouTube. Check the Studio download page for the
        current pilot installer availability and setup instructions.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <a
          className="btn-secondary inline-flex min-h-11 items-center"
          href="/download"
        >
          Download Studio
        </a>
        <a
          className="btn-secondary inline-flex min-h-11 items-center"
          href={`/games/${gameId}/studio`}
        >
          Set up Windows Studio
        </a>
      </div>
    </section>
  );
}
