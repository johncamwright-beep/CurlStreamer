"use client";
import { createContext, useContext } from "react";
export const StudioPreviewMode = createContext(false);
export const useStudioPreviewMode = () => useContext(StudioPreviewMode);
export function StudioPreviewProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <StudioPreviewMode.Provider value={enabled}>
      {children}
    </StudioPreviewMode.Provider>
  );
}
