import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { CompoundersProvider } from "@/components/CompoundersContext";
import { SidebarStateProvider } from "@/components/SidebarStateContext";
import { ZoomLock } from "@/components/ZoomLock";

// Ledger type system: Hanken Grotesk (UI/body) + JetBrains Mono (data/labels).
const sans = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <div className="accent-bar" />
        <ZoomLock />
        <CompoundersProvider>
          <SidebarStateProvider>{children}</SidebarStateProvider>
        </CompoundersProvider>
      </body>
    </html>
  );
}
