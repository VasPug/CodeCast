import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CodeCast",
  description: "Turn your code into a two-host podcast.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
