import "./globals.css";
import { AccountDisplayProvider } from "@/components/AccountDisplayProvider";
export const metadata = {
  title: "Curl Streamer",
  robots: { index: false, follow: false },
  description: "Three-phone curling broadcasts, simply.",
  other: {
    "facebook-domain-verification": "olaxpryf8jwf9guaoiwetqcoiq3jty",
  },
  icons: {
    icon: [
      {
        url: "/branding/curlstreamer-app-icon.png",
        type: "image/png",
        sizes: "1024x1024",
      },
    ],
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
        <AccountDisplayProvider>{children}</AccountDisplayProvider>
      </body>
    </html>
  );
}
