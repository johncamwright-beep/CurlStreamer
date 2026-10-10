import { MarketingHome } from "@/components/MarketingHome";
import {
  curlStreamerSearchTitle,
  curlStreamerWebsiteStructuredData,
  safeStructuredJson,
} from "@/lib/team-seo";
export const metadata = {
  title: curlStreamerSearchTitle,
  description:
    "Bring the rink to everyone. Curling broadcasts, live scoring and team pages, with private coaching statistics through the optional Shot Tracker add-on. Join the CurlStreamer pilot waitlist.",
  robots: { index: true, follow: true },
  alternates: { canonical: "https://www.curlstreamer.app/" },
  openGraph: {
    title: curlStreamerSearchTitle,
    siteName: "CurlStreamer",
    type: "website",
    url: "https://www.curlstreamer.app/",
  },
};

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: safeStructuredJson(curlStreamerWebsiteStructuredData()),
        }}
      />
      <MarketingHome />
    </>
  );
}
