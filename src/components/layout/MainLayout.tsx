import { ReactNode } from "react";
import { ResponsiveShell } from "./ResponsiveShell";
import { MobileShell } from "./MobileShell";
import { DesktopShell } from "./DesktopShell";

interface MainLayoutProps {
  children: ReactNode;
}

/**
 * MainLayout is the top-level entry point for the application's UI structure.
 * It uses ResponsiveShell to delegate rendering to either MobileShell or DesktopShell
 * based on the viewport size, ensuring complete isolation between the two layouts.
 */
export const MainLayout = ({ children }: MainLayoutProps) => {
  return (
    <ResponsiveShell
      mobile={<MobileShell>{children}</MobileShell>}
      desktop={<DesktopShell>{children}</DesktopShell>}
    />
  );
};
