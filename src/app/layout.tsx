import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "啪叽 Paji · 你的脑洞专属片场",
  description: "把你的角色捏成会动的表情包",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
