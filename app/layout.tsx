import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { PwaRegister } from "./PwaRegister";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.png`;
  const title = "PIT Unit — Tactical Pursuit Simulator";
  const description = "駕駛警車、追捕 AI 嫌犯並精準執行 PIT 的 3D 戰術追逐模擬遊戲。";
  return {
    title,
    description,
    manifest: "/manifest.webmanifest",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: { title, description, type: "website", images: [{ url: image, width: 1680, height: 945, alt: "PIT Unit 警車追逐模擬遊戲" }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-Hant"><body>{children}<PwaRegister /></body></html>;
}
