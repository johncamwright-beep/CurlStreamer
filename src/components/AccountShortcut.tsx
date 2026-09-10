"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
export function AccountShortcut() {
  const [logo, setLogo] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const previous = document.body.style.paddingRight;
    document.body.style.paddingRight =
      "max(4.5rem, calc(env(safe-area-inset-right) + 4rem))";
    void fetch("/api/account/appearance", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((value) => {
        if (
          typeof value?.logo === "string" &&
          (value.logo.startsWith("/branding/") ||
            value.logo.startsWith("https://"))
        )
          setLogo(value.logo);
      })
      .catch(() => {});
    return () => {
      controller.abort();
      document.body.style.paddingRight = previous;
    };
  }, []);
  return (
    <Link
      href="/account"
      aria-label="My account"
      title="My account"
      className="account-shortcut"
    >
      {logo ? (
        <img src={logo} alt="" />
      ) : (
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
        </svg>
      )}
    </Link>
  );
}
