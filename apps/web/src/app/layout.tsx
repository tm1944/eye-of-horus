import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
const inter = localFont({
  src: "./fonts/InterVariable.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
});
export const metadata: Metadata = { title: "Eye of Horus", description: "Technology, government, finance, and societal events around the world, on one globe." };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Browser extensions add attributes to <html> before hydration; ignore only those.
  return <html lang="en" className={inter.variable} suppressHydrationWarning><body>{children}</body></html>;
}
