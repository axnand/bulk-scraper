import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Bulk URL Processor",
  description: "Bulk LinkedIn profile scraper with AI-powered candidate analysis",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.className} min-h-screen bg-neutral-950 text-neutral-50 antialiased`} suppressHydrationWarning>
        <div className="mx-auto max-w-4xl p-6 md:p-12">
          {children}
        </div>
      </body>
    </html>
  );
}
