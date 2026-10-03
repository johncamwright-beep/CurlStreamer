import { MarketingHome } from "@/components/MarketingHome";
export const metadata = {
  title: "CurlStreamer — Curling broadcasts & team pages | Coming soon",
  description:
    "Bring the rink to everyone. Curling broadcasts, live scoring and team pages, with private coaching statistics through the optional Shot Tracker add-on. Join the CurlStreamer pilot waitlist.",
  robots: { index: true, follow: true },
  alternates: { canonical: "https://www.curlstreamer.app/" },
};

export default function HomePage() {
  return <MarketingHome />;
}
