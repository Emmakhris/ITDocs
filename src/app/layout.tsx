import type { Metadata } from "next";
import "./globals.css";

// System fonts only — the app must build and run on air-gapped hospital networks.
export const metadata: Metadata = {
  title: { default: "ITDocs", template: "%s · ITDocs" },
  description: "IT documentation management",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
