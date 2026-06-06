import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { CompoundersProvider } from "@/components/CompoundersContext";
import { SidebarStateProvider } from "@/components/SidebarStateContext";

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
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      {/* iOS Safari ignores user-scalable=no since iOS 10. Blocking multi-touch
          on touchmove is the only reliable way to prevent pinch-zoom there. */}
      <script dangerouslySetInnerHTML={{ __html:
        "document.addEventListener('touchmove',function(e){if(e.touches.length>1)e.preventDefault();},{passive:false});"
      }} />
      <body>
        <CompoundersProvider>
          <SidebarStateProvider>{children}</SidebarStateProvider>
        </CompoundersProvider>
      </body>
    </html>
  );
}
