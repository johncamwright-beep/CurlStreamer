"use client";
import { createContext, useContext } from "react";
import type { StudioSession } from "@/lib/studio-session";

export const StudioSessionContext = createContext<StudioSession | null>(null);
export const useStudioSession = () => useContext(StudioSessionContext);
