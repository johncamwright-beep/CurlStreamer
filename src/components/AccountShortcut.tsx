"use client";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
export function AccountShortcut() {
  const [logo, setLogo] = useState<string | null>(null);
  const marker = useRef<HTMLSpanElement>(null);
  const [placement, setPlacement] = useState<{
    main: HTMLElement;
    right: number;
    top: number;
  } | null>(null);
  useLayoutEffect(() => {
    const navigation = marker.current?.closest<HTMLElement>(".app-navigation");
    const main = navigation?.closest("main");
    if (!navigation || !main) return;
    let header = navigation;
    while (header.parentElement && header.parentElement !== main)
      header = header.parentElement;
    const positioned = getComputedStyle(main).position === "static";
    if (positioned) main.classList.add("account-shortcut-page");
    if (header !== navigation) {
      header.style.setProperty(
        "--account-header-padding",
        getComputedStyle(header).paddingRight,
      );
      header.classList.add("account-shortcut-header");
    }
    const align = () => {
      const bounds = main.getBoundingClientRect();
      const styles = getComputedStyle(main);
      setPlacement({
        main,
        right: parseFloat(styles.paddingRight) || 0,
        top:
          navigation.getBoundingClientRect().top -
          bounds.top +
          main.scrollTop -
          (parseFloat(styles.borderTopWidth) || 0),
      });
    };
    align();
    const observer = new ResizeObserver(align);
    observer.observe(main);
    observer.observe(navigation);
    observer.observe(header);
    window.addEventListener("resize", align);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", align);
      if (positioned) main.classList.remove("account-shortcut-page");
      header.classList.remove("account-shortcut-header");
      header.style.removeProperty("--account-header-padding");
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
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
    };
  }, []);
  const shortcut = (
    <Link
      href="/account"
      aria-label="My account"
      title="My account"
      className="account-shortcut"
      style={
        placement ? { right: placement.right, top: placement.top } : undefined
      }
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
  return (
    <>
      <span ref={marker} hidden />
      {placement && createPortal(shortcut, placement.main)}
    </>
  );
}
