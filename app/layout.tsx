import type { Metadata } from "next";
import "./globals.css";
import { PwaRegister } from "./PwaRegister";
import { publicPath } from "@/lib/publicPath";

export const dynamic = "force-static";

const title = "PIT Unit — Tactical Pursuit Simulator";
const description = "駕駛警車、追捕 AI 嫌犯並精準執行 PIT 的 3D 戰術追逐模擬遊戲。";
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const image = new URL(publicPath("/og.png"), siteUrl).toString();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  manifest: publicPath("/manifest.webmanifest"),
  icons: { icon: publicPath("/favicon.svg"), shortcut: publicPath("/favicon.svg") },
  openGraph: { title, description, type: "website", images: [{ url: image, width: 1680, height: 945, alt: "PIT Unit 警車追逐模擬遊戲" }] },
  twitter: { card: "summary_large_image", title, description, images: [image] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-Hant"><body>{children}<PwaRegister /></body></html>;
}
