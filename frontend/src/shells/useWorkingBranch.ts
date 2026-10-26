import { useEffect, useState } from "react";
import { getWorkingBranch, subscribeWorkingBranch } from "../lib/workingBranch";

/** The working branch (lib/workingBranch.ts), re-rendering when it changes. */
export function useWorkingBranch(): string {
  const [branch, setBranch] = useState(getWorkingBranch);
  useEffect(() => {
    const unsubscribe = subscribeWorkingBranch(setBranch);
    return () => {
      unsubscribe();
    };
  }, []);
  return branch;
}
