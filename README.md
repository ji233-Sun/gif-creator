# 啪叽 Paji

把你的角色捏成会动的表情包。

上传一张角色图，在浏览器里保留原画、抠出背景，再用一句话让角色表演，导出透明 GIF。需要旋转观察时，也可另选实验性 3D 建模。

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

# 启动开发服务器（首次准备固定版本的自动抠图资源）
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

## 原画开拍（默认）

上传后点击「本机定妆」。透明底输入直接保留像素；照片和有背景的立绘使用 U²-NetP 在浏览器 Worker 内抠图。`pnpm dev` 和 `pnpm build` 自动运行 `pnpm portrait:assets`，校验固定的模型文件，并复制与锁定版本匹配的 ONNX Runtime Web WASM 到 `public/portrait-model/`。仅使用透明底图或已自备静态资产时，可设置 `PAJI_SKIP_PORTRAIT_ASSETS=1` 跳过准备。部署自动抠图功能时需为 `public/portrait-model/` 提供静态资源（standalone 部署也要复制 `public`）。**本机定妆只请求同源静态资源，角色图不上传，不需要 API Key。**

第三步「开拍」输入自然语言指令（最多 600 字），配置支持图片和工具调用的 AI 导演，再确认发送裁剪后的透明图和指令。浏览器里的 `libfx` 调用受限 `direct_gif` 工具：模型返回动作轨道、可选眼嘴锚点、特效和字幕，不执行模型代码。没有返回合法动作谱时提示重试，不使用预设冒充。

原画贴到浅曲面网格。`src/score/portrait.ts` 的动作谱按时间驱动身体、头部、眯眼、眨眼、视线、口型和锚定特效；预览和导出共用渲染。导出会把临近采样点对齐明显的眨眼峰值，不额外增加帧。GIF 采用 320 px（超 1 MiB 时尝试 240 px），透明底，1.2–3 秒循环。保留头发衣服等原画细节，不支持完整绕转、独立挥手或隐藏部位重建。自动抠图遇到发丝内孔、颜色相近的背景可能残留或误删，可用「修边」画笔恢复误删或擦去残留，也可以使用预先抠好的透明图；不会自动改成几何 3D。

模型资产来自 [U²-NetP / rembg](https://github.com/danielgatis/rembg/releases/tag/v0.0.0)，参考 [U²-Net](https://github.com/xuebinqin/U-2-Net) 和 [ONNX Runtime Web](https://onnxruntime.ai/docs/get-started/with-javascript/web.html)。

## 网页内配置 AI 导演（指令开拍与实验性 3D）

本地测试请使用 `pnpm dev --hostname 127.0.0.1`，在页面顶部打开「AI 设置」，不用配置环境变量。

- **ChatGPT 订阅**：在本机通过 OpenAI 官方登录页授权；要求账号支持 ChatGPT 计划共享，并选择有图片和工具调用能力的 GPT。登录凭证仅在本机服务进程内存中，过期或重启后需要重新登录。
- **API Key**：先选择接口协议，再填写模型 ID 和对应服务的 Key。兼容网关可填写自定义 **Base URL**（包含服务要求的 `/v1` 等前缀），留空使用该协议的默认地址。应用会按协议拼接请求路径。自定义地址仅支持公网 HTTPS，不跟随重定向、不跳过证书校验。Key 仅保留在当前页面，刷新会丢失，不写入浏览器存储或本地文件。

在支持 WebAssembly JSPI 的浏览器中上传 PNG、JPEG 或 WebP 角色图（最大 10 MiB、16,777,216 像素），授权后选择「生成模型并绑定骨骼」。只有图片分析调用 AI 服务；Three.js 在浏览器用受限的立体部件（包括圆顶、裙摆和弯曲发束）、配色、材质与骨骼权重搭建 Q 版角色，不执行模型生成的代码，也不要求 Tripo 密钥。结果是风格化近似，不是写实网格或原图贴图重建；支持预览、显示骨骼和下载 GLB，GIF 导出仍未接通。

可以停止本地定妆；同一张图已取得的角色方案会在本页继续使用，不重复请求 AI。`pnpm test:run` 不访问付费服务。ChatGPT 订阅连接仅用于本机运行；对外部署前应为付费代理配置鉴权和共享配额。

## 保真原画网格实验（2.5D）

`src/model/portrait-rig.ts` 可把透明底原画贴到浅曲面蒙皮网格上，以有限角度摆动和弹跳，保留原画的脸、毛发和衣服细节。它生成连续网格，不补造背面，也不拆分肢体或重绘表情。网页「原画开拍」使用同一网格，但不导出 2.5D GLB。

在 macOS 14+ 可先本地试抠图：`swift scripts/portrait-mask.swift input.png cutout.png`。把抠图按透明边界裁剪，作为纹理传给 `createPortraitRig`，用图内颈部距裁剪框顶部的比例配置 `neckFromTop`，并将返回的场景与 `animation` 一起交给 `GLTFExporter`。脚本不上传原图；发丝或孔洞分割不准时需修掩码。
