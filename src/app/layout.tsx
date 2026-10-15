import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

// System fonts only — the app must build and run on air-gapped hospital networks.
export const metadata: Metadata = {
  title: { default: "ITDocs", template: "%s · ITDocs" },
  description: "IT documentation management",
  robots: { index: false, follow: false },
};

// Every page renders per request: the CSP nonce (set in middleware) differs each time, and Next.js
// can only put it on its scripts for dynamically rendered pages.
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await headers();
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
