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
| `DIRECTOR_PROVIDER` | `gateway`（默认）或 `deepseek` |
| `VERCEL_AI_GATEWAY_KEY` | Gateway 模式的密钥 |
| `DEEPSEEK_API_KEY` | DeepSeek 模式的密钥 |
| `TRIPO_API_KEY` | Tripo API 密钥 |
| `DIRECTOR_MODEL` | 可选；需支持图片和工具调用。DeepSeek 默认使用 `deepseek-flash` |
| `TRIPO_MODEL` / `TRIPO_RIG_MODEL` | 可选的 Tripo 生模、绑骨版本 |

在支持 WebAssembly JSPI 的浏览器中上传 PNG、JPEG 或 WebP 角色图（最大 10 MiB、16,777,216 像素），勾选第三方处理授权，再选择「生成模型并绑定骨骼」。仅选图不会发送数据；大图会在浏览器中缩小后发给 AI 导演，WebP 会由服务端转为 PNG 后发给 Tripo。页面可显示进度及骨骼，预览并下载 GLB。GIF 导出仍未接通。

「停止等待」不会取消已提交的云任务。在同一演员页面继续定妆会复用已提交的任务；如果提交结果未知，当前页面不会重新提交这一步，请先查看 Tripo 任务记录。原任务已失效或文件无法预览时，可以先重试原任务；确认重新提交对应阶段会创建新的 Tripo 任务，可能再次消耗额度。已加载的 GLB 在替换成功前仍可预览和下载。任务访问凭证只保存在当前页面，刷新或换图后不会恢复。

密钥仅存在于服务端。应用内的任务归属校验不等同于付费代理的访问控制：当前仅适合本地或受控使用，对外部署前应由可信反代覆盖客户端 IP 请求头，并为付费接口配置鉴权和共享配额。`pnpm test:run` 不访问付费服务；配置 DeepSeek 密钥后，可用 `PAJI_LIVE_DEEPSEEK=1 pnpm test:run src/director/runtime.test.ts` 测试真实 AI 与模拟 Tripo 的编排。
