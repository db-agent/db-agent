import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DB-Agent — Natural Language to SQL",
  description: "Ask your database anything in plain English. Powered by AI.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
