import { StudioPreviewProvider } from "@/components/StudioPreviewMode";
export default function BroadcastLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <StudioPreviewProvider
      enabled={process.env.CURLCAST_M1_DIRECT_SPIKE === "disposable"}
    >
      {children}
    </StudioPreviewProvider>
  );
}
