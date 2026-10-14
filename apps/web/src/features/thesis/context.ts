import { createContext, useContext } from "react";
import type { AcademicProfile, TermDetail } from "./api";

export interface ThesisContextValue {
  token: string;
  profile: AcademicProfile;
  term: TermDetail | null;
  /** Reloads the term header (phase, blockers) and bumps `revision` so panels refetch. */
  reload: () => void;
  revision: number;
  /** Runs a command, reports success or the server's blockers, and reloads on success. */
  run: <T>(label: string, action: () => Promise<T>, options?: { silent?: boolean; reload?: boolean }) => Promise<T | undefined>;
  openProject: (projectId: string | null) => void;
}

export const ThesisContext = createContext<ThesisContextValue | null>(null);

export function useThesis(): ThesisContextValue {
  const value = useContext(ThesisContext);
  if (!value) throw new Error("useThesis must be used inside ThesisPage");
  return value;
}
