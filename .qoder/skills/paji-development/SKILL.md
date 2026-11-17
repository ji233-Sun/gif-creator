---
name: paji-development
description: 在啪叽 Paji（gif-creator）仓库中开发或审查业务功能时使用。覆盖动作谱、three.js 舞台、fx 导演、Tripo 图生模型、GIF Worker、zustand 状态与 Next.js 代理；用户提到选角、定妆、开拍、杀青、接通 AI 或导出时也使用。依据实际源码区分已实现能力和架构目标，保持模块依赖和客户端与服务端边界；纯视觉任务使用 paji-ui，跨层界面任务同时使用两者。
---

# Paji 功能开发

## 获取上下文

从当前工作目录向上定位同时包含 `package.json`、`src` 和 `AGENTS.md` 的项目根目录，不依赖开发者机器的绝对路径。读取根目录 [AGENTS.md](../../../AGENTS.md)，再按任务读取 [产品策划案](../../../docs/01-product-design.md) 与 [技术选型](../../../docs/02-tech-selection.md) 的相关章节。

先检查工作区，再阅读要修改的模块及调用方。文档描述目标，源码证明现状；对实现状态的判断以当前源码为准。

## 定位改动

| 用户意图 | 优先检查 | 负责的行为 |
| --- | --- | --- |
| 上传或片场流程 | `src/ui/studio.tsx`、`src/store/index.ts` | 本地交互、跨模块流程状态 |
| 情绪动作、速度、夸张度、循环 | `src/score/types.ts`、`src/score/index.ts` | 声明式动作谱、校验与纯函数求值 |
| 模型显示、相机、材质、形变 | `src/stage/index.ts` | three.js 舞台与资源生命周期 |
| AI 导演、工具、取消、流式事件 | `src/director/runtime.ts`、`src/app/api/llm/route.ts` | fx 适配与模型请求代理 |
| 图生 3D、任务轮询、模型加载 | `src/model/provider.ts`、`src/model/tripo.ts`、`src/app/api/model/route.ts` | 提供商接口、客户端编排与服务端密钥 |
| GIF、尺寸、透明背景、体积 | `src/export/index.ts`、`src/export/worker.ts` | 确定性取帧与 Worker 编码 |
| 本地保存、恢复作品 | `src/store/index.ts` | zustand 与待实现的 IndexedDB 仓库 |

涉及界面时同时读取 [paji-ui](../paji-ui/SKILL.md)。模块迁移后更新本表和根目录约定。

## 先确认实现状态

截至本技能编写时，可用能力是 Studio 的本地 UI 和 CSS 动效示例；不要把它们当成后续模块已经可用的证据。

- `Stage` 为空类，`evaluate` 返回空对象，`DirectorRuntime` 是占位接口。
- `TripoProvider.generate` 与 `exportGif` 抛出未实现错误；GIF Worker 不编码任何数据。
- store 只有流程步骤，Studio 仍用组件内状态；没有 IndexedDB 或作品保存。
- LLM 代理只读取 JSON 上游响应，不提供 SSE。模型代理只转发图片请求，不编排任务轮询或下载 GLB。
- 当前上传不会调用这两个代理；`DIRECTOR_MODEL` 尚未被运行时读取。

每次接通能力时重新核对上述状态，并同步受影响的产品提示与开发说明。

## 按模块边界实现

1. 先确认输入、输出、取消语义和可观察的完成条件，再修改最小闭环。
2. 以 `ui → director / stage / export → score` 为目标依赖方向；`score` 不导入 React、DOM、three.js、网络或存储。
3. 用声明式动作谱描述动作。为来自模型或外部的数据增加边界校验，通过后再求值，不使用 `eval`、`Function` 或执行模型生成的代码。
4. 将渲染归入 Stage，将 libfx 能力与调用封装在 `director/runtime.ts`，不要让页面直接耦合 SDK 运行时。
5. 沿用 `ModelProvider.generate(image: Blob, signal?: AbortSignal): Promise<{ glb: Blob }>` 抽象；需要改变契约时一并更新调用方。
6. 浏览器通过本项目的 `/api/llm` 和 `/api/model` 请求上游；密钥留在服务端环境变量。调用真实第三方服务前补齐相关输入限制与用户告知。
7. 让预览和导出共享动作求值语义，按显式时间采样；GIF 编码放到 Worker，释放本次创建的 Worker、Blob URL 和 GPU 资源。
8. 局部展示状态留在 React，跨模块状态才进入 zustand。需要持久化时先设计可恢复的数据与资源所有权，不把渲染器实例写进 IndexedDB。

不要为尚未被请求的功能添加账户、后端数据库、框架替代方案或通用插件系统。

## 验证改动

从仓库根目录执行适合本次修改的检查：

```sh
pnpm exec tsc --noEmit
pnpm exec eslint src tailwind.config.ts
pnpm test:run
pnpm build
```

- 动作谱：覆盖起止时间、时间缩放、夸张度、组合与循环边界；现有返回值存在测试只是占位。
- 舞台与导出：使用固定动作谱检查帧数、尺寸、透明背景、首尾衔接与资源释放；不能只以文件非空判定 GIF 正确。
- 提供商与代理：验证输入、配置缺失、上游错误和取消；用桩或明确授权的真实调用，不在普通验证时产生付费生成任务。
- 导演：区分协议与工具输入的自动化验证和情绪输出的人工评审，不把模型文案写成脆弱的固定字符串断言。
- UI 链路：按 paji-ui 的流程在浏览器实测，并确认示例态没有被当作真实生成结果。

构建前检查开发服务是否正在使用 `.next`，避免开发与构建并发写同一目录。`standalone` 不会禁用 SSR，浏览器 API 仍需客户端边界。

## 交付说明

说明接通了哪一段链路、如何验证以及剩余能力；外部凭证或服务阻塞时报告具体边界，不以模拟成功替代。更新实现状态发生变化的项目说明，仅在用户要求时提交或推送。
