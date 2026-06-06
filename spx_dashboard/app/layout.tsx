import type { Metadata } from "next";
import "./globals.css";
import { CompoundersProvider } from "@/components/CompoundersContext";

export const metadata: Metadata = {
  title: "Mendo Monitor",
  description: "AI beneficiary & software tracker within the S&P 500",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <CompoundersProvider>{children}</CompoundersProvider>
      </body>
    </html>
  );
}
