import "./globals.css";
import { CurlStreamerAppBadge } from "@/components/CurlStreamerBrand";
export const metadata = {
  title: "Curl Streamer",
  description: "Three-phone curling broadcasts, simply.",
  icons: {
    icon: "/branding/curlstreamer-icon.png",
  },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <CurlStreamerAppBadge />
        {children}
      </body>
    </html>
  );
}
