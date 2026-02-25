import { ReactNode, useEffect, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";

interface ResponsiveShellProps {
  mobile: ReactNode;
  desktop: ReactNode;
}

/**
 * ResponsiveShell swaps between mobile and desktop layouts.
 * It uses the useIsMobile hook and handles the hydration/detection delay.
 */
export const ResponsiveShell = ({ mobile, desktop }: ResponsiveShellProps) => {
  const isMobile = useIsMobile();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    // Return desktop by default or a loader to avoid layout shift if possible,
    // but usually desktop is safer for initial SSR/static render.
    return <>{desktop}</>;
  }

  return isMobile ? <>{mobile}</> : <>{desktop}</>;
};
