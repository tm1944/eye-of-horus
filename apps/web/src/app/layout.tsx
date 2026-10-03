import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Hypothesis Globe", description: "Open sensor events and source-linked hypotheses." };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
