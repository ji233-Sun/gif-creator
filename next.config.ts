import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 工作室页面是纯客户端组件，关闭服务端渲染以兼容 wasm Agent
  // 后续若需要 SSR 可再开启
  output: "standalone",
  experimental: {
    // 允许 libfx 等依赖的 wasm 文件被正确打包
    // @see https://github.com/vercel-labs/fx
  },
};

export default nextConfig;
