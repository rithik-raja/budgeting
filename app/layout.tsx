import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "Budgeting",
  description: "Personal monthly cash flow",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={cn(
        "dark h-full antialiased",
        inter.variable,
        geistMono.variable
      )}
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <header className="border-b bg-background">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
            <Button
              variant="ghost"
              size="sm"
              render={<Link href="/" />}
              nativeButton={false}
            >
              Budgeting
            </Button>
            <nav>
              <Button
                variant="ghost"
                size="sm"
                render={<Link href="/categories" />}
                nativeButton={false}
              >
                Categories
              </Button>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <Toaster />
      </body>
    </html>
  );
}
