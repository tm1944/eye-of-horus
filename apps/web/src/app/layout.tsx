import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
const inter = localFont({
  src: "./fonts/InterVariable.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
});
export const metadata: Metadata = { title: "Eye of Horus", description: "The world's news, on one globe: technology, government, finance, societal events, and natural hazards." };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Browser extensions add attributes to <html> before hydration; ignore only those.
  return <html lang="en" className={inter.variable} suppressHydrationWarning><body>{children}</body></html>;
}
