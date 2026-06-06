import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { CompoundersProvider } from "@/components/CompoundersContext";
import { SidebarStateProvider } from "@/components/SidebarStateContext";
import { ZoomLock } from "@/components/ZoomLock";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Mendo Monitor",
  description: "AI beneficiary & software tracker within the S&P 500",
  robots: { index: false, follow: false },
};

// Render the desktop layout on every device. Pinning the viewport to a fixed
// desktop width (wide enough to fit the widest table without horizontal scroll)
// makes mobile browsers zoom the whole page out to fit the screen — same
// proportions as desktop, just smaller. Zoom stays disabled (see ZoomLock).
export const viewport: Viewport = {
  width: 1600,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body>
        <ZoomLock />
        <CompoundersProvider>
          <SidebarStateProvider>{children}</SidebarStateProvider>
        </CompoundersProvider>
      </body>
    </html>
  );
}
