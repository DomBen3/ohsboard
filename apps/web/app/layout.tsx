import type { Metadata } from "next";
import { Saira_Condensed, Saira, Share_Tech_Mono } from "next/font/google";
import { Sidebar } from "@/components/sidebar";
import "./globals.css";

const display = Saira_Condensed({
  subsets: ["latin"],
  weight: ["500", "700", "900"],
  variable: "--font-display",
  display: "swap",
});

const body = Saira({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-body",
  display: "swap",
});

const mono = Share_Tech_Mono({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "OhsBoard",
  description: "Live odds tracker",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${mono.variable}`}
    >
      <body className="min-h-screen">
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 relative">{children}</main>
        </div>
      </body>
    </html>
  );
}
