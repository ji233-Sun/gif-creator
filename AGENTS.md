# 啪叽 Paji 开发约定

本仓库把角色图转为会动的表情包，产品流程为「选角 → 定妆 → 开拍 → 杀青」。首版面向单角色、单张原型图、GIF 导出；账号、社区、付费、云同步和视频导出不在当前范围。

## 开始工作

1. 查看 `git status --short`，保留用户已有修改。
2. 从实际源码和 `package.json` 确认现状；`docs/01-product-design.md` 和 `docs/02-tech-selection.md` 是产品与架构目标，不代表能力已经实现。
3. 根据任务读取项目 Skill：
   - 功能开发、接口、动作谱、舞台、导演、模型、导出或状态管理：`.qoder/skills/paji-development/SKILL.md`。
   - UI SDK、页面、组件、粉蓝视觉、交互或响应式：`.qoder/skills/paji-ui/SKILL.md`。
   - 涉及前后端链路的界面任务，同时读取两份。
4. 保持变更与请求相符，完成相应验证后再报告结果。

## 技术栈与入口

- Next.js 15 App Router、React 19、TypeScript strict，路径别名 `@/*` 指向 `src/*`。
- UI 使用 https://ui-sdk.dev/ 的 `@ui-sdk/react` 与 `@ui-sdk/core`，两者锁定同一确切版本；目前为 `0.1.0-beta.5`。
- 使用 Tailwind CSS 3、全局 CSS 和 `lucide-react`。不要照搬 Tailwind 4 的接入语法。
- 业务目标依赖 three.js、libfx、gifenc、zustand；已安装不代表业务链路已接通。
- 使用 pnpm，版本以 `package.json#packageManager` 为准，依赖变化同时更新 `pnpm-lock.yaml`。
- 页面入口是 `src/app/page.tsx`，交互容器是 `src/ui/studio.tsx`，示例角色是 `src/ui/mascot.tsx`。

## 模块地图与真实状态

| 模块 | 负责的边界 | 当前实现 |
| --- | --- | --- |
| `src/app` | 页面、布局、图标与服务端代理 | 首页挂载 Studio；两个 POST 代理具备基础转发，不具备完整业务编排 |
| `src/ui` | 四幕界面、交互和组件展示 | 角色图本地预览、示例演员、情绪、滑条、字幕、暂停、指南和作品空态 |
| `src/stage` | three.js 场景、GLB、材质、形变和离屏渲染 | `Stage` 为空类，尚未接通 three.js |
| `src/score` | 动作谱类型、校验、纯函数求值和动作词汇表 | 有 `Score`、`ScoreClip`、`Knobs` 类型；`evaluate` 仅返回空对象 |
| `src/director` | fx 运行时适配、导演提示和工具 | `runtime.ts` 仅声明占位接口 |
| `src/model` | 图生模型提供商抽象与实现 | `ModelProvider.generate(image, signal)` 已定义；`TripoProvider.generate` 抛出未实现错误 |
| `src/export` | 逐帧采样、GIF 编码 Worker 和平台预设 | `exportGif` 抛出未实现错误，Worker 只注册空消息处理 |
| `src/store` | 跨模块状态及未来 IndexedDB 仓库 | 只有流程步骤的 zustand store，Studio 仍使用本地 React 状态，无持久化 |
| `src/lib` | 小型通用工具 | `cn` 拼接类名 |

内置演员是 CSS 动画示例，不是 AI 输出或 3D 模型。作品页为空态，不存在已保存作品；当前上传只创建本地 Blob URL，不调用代理。

## 依赖方向与实现边界

目标依赖方向为 `ui → director / stage / export → score`；接入尚未实现的模块时遵守此方向，不为满足图示添加空调用。

- `score` 保持纯 TypeScript，不依赖 React、DOM、three.js、网络或存储。动作谱使用可校验的声明式数据，不执行模型生成的脚本。
- three.js 资源生命周期和渲染逻辑归 `stage`；按给定时间求值，预览和离屏导出共用确定性的动作语义。
- 所有 libfx 调用收敛到 `src/director/runtime.ts`；在此适配浏览器能力、取消、事件与工具，UI 和舞台不直接导入 libfx。
- 图生 3D 通过 `ModelProvider` 隔离提供商。服务端代理持有密钥；浏览器不直连需要私钥的服务。
- GIF 编码放在 Worker 中，导出不依赖实时播放帧率；实现时释放 Worker、Blob URL、渲染器和 GPU 资源。
- 状态只在需要跨模块共享时进入 zustand；不要把上传预览改成隐式上传或持久化。

## 视觉和交互

统一使用樱花粉、晴空蓝、奶白底、圆角卡片和轻量漫画细节。主色和语义变量在 `src/app/globals.css`，Tailwind 色阶在 `tailwind.config.ts`；改色时同步两处，避免另起一套主题。

UI SDK 按组件子路径导入，例如 `@ui-sdk/react/tabs`；保留 SDK 的键盘操作、焦点管理和状态属性，自定义视觉放在项目样式里。它不是 Radix、Vercel AI SDK 或同名 npm 包。

文案沿用「片场、演员、导演、情绪」隐喻。未接通的功能明确显示筹备状态，示例结果明确标注示例；不要放假进度、假生成结果或虚构作品。

## 服务端与数据

- 密钥只在服务端环境变量中读取：`VERCEL_AI_GATEWAY_URL`、`VERCEL_AI_GATEWAY_KEY`、`TRIPO_API_KEY`；`DIRECTOR_MODEL` 为规划中的导演配置。
- 不把密钥写入 `NEXT_PUBLIC_*`、客户端 props、日志或文档，不提交真实环境文件。
- `/api/llm` 当前转发 JSON 并读取 JSON 响应，尚未实现流式协议；`/api/model` 当前只转发 multipart 请求，尚未轮询任务或取回 GLB。
- 限流、完整入参校验、任务轮询、取消透传和动作谱校验尚未落地，不能把这些当成已有保障。
- 接通真实服务时，在服务端验证外部输入、限制图片大小和类型，并在首次向第三方发送图片前明确告知用户。
- 当前本地上传仅支持 PNG、JPEG、WebP，最大 10 MiB；替换、移除和卸载时释放 Blob URL。维护成功、错误和空态。

## 开发与验证

在仓库根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm exec tsc --noEmit
pnpm exec eslint src tailwind.config.ts
pnpm test:run
pnpm build
```

根据变更选择检查：文档只校验内容、链接和 Skill 元数据；代码改动运行类型与静态检查；纯函数、动作谱或编码改动补充行为测试；界面改动启动服务并用浏览器实测。生产构建也包含 lint 和类型检查。

目前 `src/score/score.test.ts` 只有一条「返回值存在」的占位测试；通过它不能证明动画、无缝循环或 GIF 编码正确。

UI 至少检查桌面与手机、主要流程、空态和异常；涉及当前控件时覆盖情绪方向键、滑条边界、字幕键盘切换、暂停、弹窗 Escape 与焦点返回，以及减少动态效果偏好。上传改动覆盖错误类型、超限、损坏图片、拖放和替换。

### 构建目录与生产预览

`output: "standalone"` 只决定输出形式，不会关闭 SSR；使用浏览器 API 的模块仍需正确划分客户端边界。

不要让 `pnpm dev` 与 `pnpm build` 同时写入默认 `.next`。先停止自己启动的开发服务再构建，或明确使用独立输出目录；不终止不明归属的进程。

需要 standalone 预览时，构建完成后复制静态资源再启动：

```sh
cp -R .next/static .next/standalone/.next/static
PORT=3001 HOSTNAME=127.0.0.1 node .next/standalone/server.js
```

上述复制命令用于本次新生成、尚无 `static` 子目录的 standalone 产物；若已有该目录，先检查状态，避免重复嵌套复制。将来引入 `public` 资源时也需随 standalone 产物提供。

## 交付

报告实际完成内容、验证结果和仍未实现的能力。仅在用户明确要求时创建提交或推送；使用具体文件路径暂存，检查 diff 和敏感信息，保留仓库的中文 Conventional Commits 风格，不跳过钩子、不强推。
