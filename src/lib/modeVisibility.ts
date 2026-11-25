import { createContext, useContext } from "react";

/** Visited workspaces retain their drafts, but only the visible one handles window input. */
export const ModeVisibility = createContext(true);
export function useModeActive() { return useContext(ModeVisibility); }
