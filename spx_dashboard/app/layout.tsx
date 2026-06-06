import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { CompoundersProvider } from "@/components/CompoundersContext";

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

// Fit the viewport to the device but let users pinch-zoom out to take in the
// full width of the data tables on small screens.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  minimumScale: 0.25,
  maximumScale: 5,
  userScalable: true,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body>
        <CompoundersProvider>{children}</CompoundersProvider>
      </body>
    </html>
  );
}
