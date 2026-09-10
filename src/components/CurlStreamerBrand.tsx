"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import styles from "./CurlStreamerBrand.module.css";

export function CurlStreamerLogo({ className = "" }: { className?: string }) {
  return (
    <div className={`${styles.fullLogo} ${className}`.trim()}>
      <Image
        src="/branding/curlstreamer-logo.png"
        alt="Curl Streamer"
        width={2172}
        height={724}
        priority
      />
    </div>
  );
}

function isProgramSurface(pathname: string) {
  return (
    /^\/broadcast\/[^/]+\/?$/.test(pathname) ||
    /^\/studio-m3\/[^/]+\/program\/?$/.test(pathname) ||
    /^\/(?:render|overlay|watch|live)(?:\/|$)/.test(pathname)
  );
}

export function CurlStreamerAppBadge() {
  const pathname = usePathname();
  const showBadge =
    !["/", "/login", "/signup"].includes(pathname) &&
    !isProgramSurface(pathname);

  useEffect(() => {
    if (!showBadge) return;
    const previousPadding = document.body.style.paddingRight;
    document.body.style.paddingRight =
      "max(3.5rem, calc(env(safe-area-inset-right) + 3rem))";
    return () => {
      document.body.style.paddingRight = previousPadding;
    };
  }, [showBadge]);

  if (!showBadge) return null;
  return (
    <div
      className={styles.appBadge}
      data-testid="curlstreamer-app-brand"
      aria-hidden="true"
    >
      <Image
        src="/branding/curlstreamer-icon.png"
        alt=""
        width={1254}
        height={1254}
        priority
      />
    </div>
  );
}
