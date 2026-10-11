import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_Malayalam } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next";

import { Toaster } from "@/components/ui/sonner";
import { TRPCReactProvider } from "@/trpc/client";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const notoMl = Noto_Sans_Malayalam({
  subsets: ["malayalam"],
  weight: ["400", "600", "700"],
  variable: "--font-noto-ml",
});

export const metadata: Metadata = {
  title: {
    template: "%s · PhysioCoach",
    default: "PhysioCoach",
  },
  description:
    "Guided home physiotherapy in Malayalam: physiotherapists prescribe exercises, an AI coach counts reps live, and progress is tracked without storing video.",
  applicationName: "PhysioCoach",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#14A39A" },
    { media: "(prefers-color-scheme: dark)", color: "#0F2A30" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${notoMl.variable} font-sans antialiased`}
      >
        <NuqsAdapter>
          <TRPCReactProvider>
            <Toaster />
            {children}
          </TRPCReactProvider>
        </NuqsAdapter>
      </body>
    </html>
  );
}
