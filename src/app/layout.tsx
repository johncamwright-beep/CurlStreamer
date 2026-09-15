import "./globals.css";
export const metadata = {
  title: "Curl Streamer",
  robots: { index: false, follow: false },
  description: "Three-phone curling broadcasts, simply.",
  other: {
    "facebook-domain-verification": "olaxpryf8jwf9guaoiwetqcoiq3jty",
  },
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
      <body>{children}</body>
    </html>
  );
}
