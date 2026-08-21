import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ReviveAI — Autonomous Payment Revenue Recovery",
  description:
    "AI-powered revenue recovery agent that detects failed payments, diagnoses root causes, and autonomously executes recovery workflows.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#0b0f19] text-slate-100 antialiased selection:bg-emerald-500 selection:text-white">
        {children}
      </body>
    </html>
  );
}
