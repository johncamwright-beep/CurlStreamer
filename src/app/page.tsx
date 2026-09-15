import { MarketingHome } from "@/components/MarketingHome";
export const metadata = {
  title: "CurlStreamer — Curling broadcasts & team pages | Coming soon",
  description:
    "Bring the rink to everyone. Phone cameras, live scoring, audio, sponsors and your own team page. Join the CurlStreamer pilot waitlist.",
  robots: { index: true, follow: true },
  alternates: { canonical: "https://www.curlstreamer.app/" },
};

export default function HomePage() {
  return <MarketingHome />;
}
