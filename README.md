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

## 网页内配置 AI 导演

本地测试请使用 `pnpm dev --hostname 127.0.0.1`，在页面顶部打开「AI 设置」，不用配置环境变量。

- **ChatGPT 订阅**：在本机通过 OpenAI 官方登录页授权；要求账号支持 ChatGPT 计划共享，并选择有图片和工具调用能力的 GPT。登录凭证仅在本机服务进程内存中，过期或重启后需要重新登录。
- **API Key**：先选择接口协议，再填写模型 ID 和对应服务的 Key。兼容网关可填写自定义 **Base URL**（包含服务要求的 `/v1` 等前缀），留空使用该协议的默认地址。应用会按协议拼接请求路径。自定义地址仅支持公网 HTTPS，不跟随重定向、不跳过证书校验。Key 仅保留在当前页面，刷新会丢失，不写入浏览器存储或本地文件。

在支持 WebAssembly JSPI 的浏览器中上传 PNG、JPEG 或 WebP 角色图（最大 10 MiB、16,777,216 像素），授权后选择「生成模型并绑定骨骼」。只有图片分析调用 AI 服务；Three.js 在浏览器用基础几何体、颜色和骨骼权重搭建 Q 版角色，不执行模型生成的代码，也不要求 Tripo 密钥。结果是风格化近似，不是写实网格或原图贴图重建；支持预览、显示骨骼和下载 GLB，GIF 导出仍未接通。

可以停止本地定妆；同一张图已取得的角色方案会在本页继续使用，不重复请求 AI。`pnpm test:run` 不访问付费服务。ChatGPT 订阅连接仅用于本机运行；对外部署前应为付费代理配置鉴权和共享配额。
