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
- **图生 3D**：视觉模型生成受限角色方案，Three.js 在浏览器构建蒙皮并导出 GLB
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
├─ model/          角色方案校验、本地蒙皮与 GLB 生成
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
| `DIRECTOR_PROVIDER` | `gateway`（默认）或 `deepseek` |
| `VERCEL_AI_GATEWAY_KEY` | Gateway 模式的密钥 |
| `DEEPSEEK_API_KEY` | DeepSeek 模式的密钥 |
| `DIRECTOR_MODEL` | 可选；需支持图片和工具调用。DeepSeek-V4.1-Flash-1017 的 API ID 是 `deepseek-flash` |

在支持 WebAssembly JSPI 的浏览器中上传 PNG、JPEG 或 WebP 角色图（最大 10 MiB、16,777,216 像素），授权后选择「生成模型并绑定骨骼」。只有图片分析调用 AI 服务；Three.js 在浏览器用基础几何体、颜色和骨骼权重搭建 Q 版角色，不执行模型生成的代码，也不要求 Tripo 密钥。结果是风格化近似，不是写实网格或原图贴图重建；支持预览、显示骨骼和下载 GLB，GIF 导出仍未接通。

可以停止本地定妆；同一张图已取得的角色方案会在本页继续使用，不重复请求 AI。密钥仅存在于服务端；对外部署前应为付费代理配置鉴权和共享配额。`pnpm test:run` 不访问付费服务；配置 DeepSeek 密钥后，可用 `PAJI_LIVE_DEEPSEEK=1 pnpm test:run src/director/runtime.test.ts` 实测角色方案响应。
