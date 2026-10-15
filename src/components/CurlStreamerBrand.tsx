"use client";

import Image from "next/image";
import styles from "./CurlStreamerBrand.module.css";

export function CurlStreamerLogo({ className = "" }: { className?: string }) {
  return (
    <div className={`${styles.fullLogo} ${className}`.trim()}>
      <Image
        src="/branding/curlstreamer-logo.png"
        alt="Curl Streamer"
        width={2000}
        height={500}
        priority
      />
    </div>
  );
}

export function CurlStreamerAppBadge() {
  return (
    <div
      className={styles.appBadge}
      data-testid="curlstreamer-app-brand"
      aria-hidden="true"
    >
      <Image
        src="/branding/curlstreamer-icon.png"
        alt=""
        width={1024}
        height={1024}
        priority
      />
    </div>
  );
}
