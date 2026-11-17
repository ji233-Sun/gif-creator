# 啪叽 Paji

把你的角色捏成会动的表情包。

上传一张角色图，AI 导演把它变成 3D 小演员；说一句"裂开"，它就演给你看，然后导出 GIF。

## 文档

- [策划案](./docs/01-product-design.md)：定位、核心体验、趣味机制、范围与里程碑
- [技术选型](./docs/02-tech-selection.md)：架构、Agent 运行时（fx）、图生 3D、动作谱、GIF 导出

## 技术栈

- **应用框架**：Next.js 15（App Router）+ TypeScript 5
- **界面**：React 19 + Tailwind CSS 3 + zustand
- **3D 渲染**：three.js
- **Agent 运行时**：libfx（WebAssembly，浏览器内运行）
- **图生 3D**：Tripo API v3（经后端代理）
- **GIF 编码**：gifenc（Web Worker）
- **本地存储**：IndexedDB
- **包管理 / 测试**：pnpm + Vitest

## 本地开发

```bash
# 安装依赖
pnpm install

# 复制环境变量模板并填写密钥
cp .env.example .env.local

# 启动开发服务器
pnpm dev
```

打开 <http://localhost:3000>。

## 目录结构

```
src/
├─ app/            页面与 /api 代理路由
├─ stage/          three.js 舞台、材质、形变着色器
├─ score/          动作谱类型、校验、求值器、动作词汇表
├─ director/       fx 适配层、提示词、工具定义
├─ model/          ModelProvider 接口与 Tripo 实现
├─ export/         取帧、GIF 编码 Worker、平台预设
├─ store/          zustand 状态与 IndexedDB 仓库
├─ ui/             四幕界面组件
└─ lib/            通用工具函数
```

## 可用脚本

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 启动 Next.js 开发服务器 |
| `pnpm build` | 构建生产包 |
| `pnpm start` | 启动生产服务器 |
| `pnpm lint` | 运行 ESLint |
| `pnpm test` | 运行 Vitest（监听模式） |
| `pnpm test:run` | 运行 Vitest 一次 |

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `VERCEL_AI_GATEWAY_URL` | Vercel AI Gateway 地址 |
| `VERCEL_AI_GATEWAY_KEY` | Vercel AI Gateway 密钥 |
| `TRIPO_API_KEY` | Tripo API 密钥 |
| `DIRECTOR_MODEL` | 导演使用的模型型号 |

这些密钥只存在于服务端环境变量中，浏览器通过 `/api/llm` 与 `/api/model` 代理访问上游服务。
