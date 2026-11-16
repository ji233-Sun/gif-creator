# 啪叽 Paji 技术选型

> 文档状态：v0.1（立项稿）· 2026-11-16
> 配套阅读：[策划案](./01-product-design.md)

## 1. 结论速览

| 领域 | 选型 | 一句话理由 |
| --- | --- | --- |
| Agent 运行时 | **fx**（`libfx` 的 WebAssembly 构建，跑在浏览器里） | 工具直接操作页面里的 3D 场景，截图可作为工具结果回传给模型 |
| 模型接入 | Vercel AI Gateway，经自有后端代理 | fx 原生支持；密钥不进浏览器 |
| 图生 3D | Tripo API（v3），封装在 `ModelProvider` 接口后 | 有图生模型、绑骨、动作重定向的完整链路，后续可扩展骨骼 |
| 3D 渲染 | three.js（直接使用，不套 React 渲染器） | 需要确定性的离屏逐帧渲染和命令式的工具调用 |
| 动画表示 | 自定义声明式"动作谱"JSON | 可校验、可回放、可本地微调，不执行 AI 写的代码 |
| GIF 编码 | `gifenc`，放在 Web Worker | 体积小，支持透明色和自定义调色板 |
| 应用框架 | Next.js（App Router）+ TypeScript | 一个工程同时提供页面和两个代理路由 |
| 界面 | React + Tailwind CSS + zustand | 界面简单，不引入更重的方案 |
| 本地存储 | IndexedDB | 模型文件、动作谱、会话存档都留在本地，不建数据库 |
| 包管理与测试 | pnpm，Vitest | 动作谱求值是纯函数，适合单元测试 |

## 2. 系统结构

```
浏览器
├─ 界面层（React）            四幕流程、对话、旋钮、时间轴
├─ 导演（fx Agent, wasm）     读图、写动作谱、看预览、自我修正
│     └─ 工具（JS 函数）────┐
├─ 舞台（three.js）  ◄──────┘  加载模型、按时间 t 求值动作谱、渲染
├─ 导出（Web Worker）         逐帧取像素 → 调色板量化 → GIF
└─ 仓库（IndexedDB）          角色、模型文件、动作谱、会话存档

后端（Next.js 路由，仅做代理）
├─ /api/llm    → Vercel AI Gateway   注入密钥，限流
└─ /api/model  → Tripo API           上传图片、轮询任务、转发模型文件
```

要点：Agent 的循环在浏览器里跑，后端不保存任何状态，只负责藏密钥和限流。

## 3. Agent 运行时：为什么是 fx

### 3.1 fx 是什么

fx 是 Vercel Labs 开源的 Agent harness，用 Zig 编写，Apache-2.0 许可。它的核心以 `libfx` 这个 npm 包提供，有原生 Node 插件和 WebAssembly 两种构建，后者可以在浏览器里运行完整的 Agent 循环。

### 3.2 与本项目的契合点

| 需求 | fx 提供的能力 |
| --- | --- |
| 工具要直接改页面里的 three.js 场景 | 工具就是应用里的 JS 函数，`execute(input, context)` |
| 导演要能"看见"模型和动画 | 提示支持图片输入；工具结果可携带最多 8 张图片 |
| 导演喊话要流式显示 | 事件流含 `text_delta`、`tool_start`、`tool_end` |
| 用户在生成中途插话（"再夸张点"） | 支持 steering，向进行中的回合追加指令 |
| 用户取消 | `session.cancel()` 或 `AbortSignal` |
| 关掉页面后继续上次的对话 | 支持会话存档与恢复 |

最小用法示意（依据 libfx 0.0.17 文档）：

```ts
import { createFxAgent, supportsJspi } from 'libfx/browser'

if (!supportsJspi()) throw new Error('当前浏览器不支持')

const agent = createFxAgent({
  model: DIRECTOR_MODEL,
  instructions: DIRECTOR_PROMPT,
  tools: [{
    name: 'preview_frames',
    description: '按给定时间点渲染当前动作谱，返回一张拼图供检查。',
    inputSchema: {
      type: 'object',
      properties: { times: { type: 'array', items: { type: 'number' }, maxItems: 8 } },
      required: ['times'],
      additionalProperties: false,
    },
    idempotent: true,
    async execute({ times }) {
      return {
        type: 'libfx.tool-result',
        text: `已渲染 ${times.length} 帧。`,
        images: [{ type: 'image', mimeType: 'image/png', data: await stage.contactSheet(times) }],
      }
    },
  }],
})
```

### 3.3 已知限制与应对

| 限制 | 应对 |
| --- | --- |
| 仍是实验性版本（查阅时为 0.0.17），接口变动频繁 | 锁定确切版本；所有调用收拢在一个 `director/runtime.ts` 适配层，界面和舞台不直接依赖 libfx |
| WebAssembly 构建依赖 JSPI，官方只点名了 Chrome 和 Safari 27+ | 启动时用 `supportsJspi()` 检测，不支持则给出明确提示；其余浏览器的支持情况在 M0 实测 |
| 浏览器里没有环境变量，密钥要显式传入 | 不把密钥下发到浏览器，模型请求走自有后端代理（代理的具体接法在 M0 确认） |
| WebAssembly 下工具调用是串行的 | 工具设计成粗粒度（一次写完整动作谱），减少调用次数 |
| 单个工具结果的文本上限 64 KiB，图片上限 8 张 | 多视角和多帧预览都拼成一张拼图返回 |
| libfx 自身不做权限控制 | 每个工具在 `execute` 内校验输入；工具只能改舞台状态，没有网络和文件能力 |

### 3.4 备选方案

| 方案 | 不选的原因 |
| --- | --- |
| Vercel AI SDK 的工具循环（浏览器端） | 成熟稳定，是首选的退路。但中途插话、会话存档需要自己实现 |
| 服务端 Agent（如 Claude Agent SDK） | 工具要操作的场景在浏览器里，每次工具调用都得往返一次，截图还要上传，延迟和复杂度都更高 |

如果 M0 发现 fx 在目标浏览器上不可用，按上表第一行替换，改动范围限于适配层。

### 3.5 导演的工具集

工具少而粗，每个只做一件事。

| 阶段 | 工具 | 作用 |
| --- | --- | --- |
| 定妆 | `view_model` | 返回四视角拼图，供导演对照原图写质检报告 |
| 定妆 | `tag_anchors` | 标注头顶、脸、身体中心等锚点，供特效贴纸挂载 |
| 开拍 | `get_stage_info` | 返回角色尺寸、锚点、可用动作词汇表 |
| 开拍 | `set_takes` | 一次写入三条动作谱（正常、夸张、发疯） |
| 开拍 | `patch_take` | 修改某一条动作谱的局部 |
| 开拍 | `preview_frames` | 渲染若干时间点的拼图，供导演自查 |

导演的自查最多两轮，避免为了细节反复消耗。

## 4. 图生 3D

### 4.1 选型

采用 Tripo API。查阅时其 v3 接口提供三段可串联的异步任务：

1. 图生模型：`POST /v3/generation/image-to-model`
2. 绑骨：`POST /v3/animations/rig`
3. 动作重定向：`POST /v3/animations/retarget`

首版只用第 1 步，拿到 GLB 即可。第 2、3 步留给 M5 的骨骼动作。

### 4.2 隔离方式

```ts
interface ModelProvider {
  generate(image: Blob, signal: AbortSignal): Promise<{ glb: Blob }>
}
```

舞台和导演只认这个接口。Meshy、混元 3D 等同类服务的对比结论互相矛盾（多数来自厂商自己的博客），所以不在文档里下定论，保留替换的余地即可。

### 4.3 模型进入舞台后的处理

| 处理 | 目的 |
| --- | --- |
| 归一化尺寸与朝向，落到地面 | 动作谱的参数与角色大小无关 |
| 替换为卡通材质并加描边 | 统一风格，掩盖生成瑕疵；色块更平，GIF 的 256 色调色板也更够用 |
| 按高度分区（头、身、腿） | 支撑"大头""短腿"整形滑条 |

## 5. 动画：动作谱

### 5.1 为什么不让 AI 直接写动画代码

- 执行模型生成的代码有安全风险，且出错时难以定位。
- 代码无法被"夸张度旋钮"这类本地微调统一缩放。
- 声明式数据可以用 JSON Schema 校验，而 fx 的工具入参本来就是 JSON Schema。

### 5.2 结构

```json
{
  "duration": 1.6,
  "fps": 20,
  "actor": [
    { "verb": "bounce", "from": 0, "to": 1.6, "params": { "height": 0.4, "times": 2 } },
    { "verb": "squash", "from": 0.35, "to": 0.5, "params": { "amount": 0.5 } },
    { "verb": "shake", "from": 0.8, "to": 1.6, "params": { "amplitude": 0.08, "frequency": 14 } }
  ],
  "camera": [
    { "verb": "punch_in", "from": 0.8, "to": 1.0, "params": { "zoom": 1.8 } }
  ],
  "fx": [
    { "type": "sweat", "anchor": "head", "from": 0.2, "to": 1.4 }
  ],
  "caption": { "text": "收到", "style": "slam" }
}
```

### 5.3 关键设计

| 设计 | 说明 |
| --- | --- |
| 纯函数求值 | `evaluate(score, t, knobs) → 姿态`。同一个 t 永远得到同一帧，预览、拖动时间轴、导出共用一条路径 |
| 动作词汇表 | 每个 `verb` 是一个独立的小函数，登记在注册表里。新增动作不改求值器 |
| 无缝循环 | 每个动作在片段结束时回到静止姿态；校验器检查 `t=0` 与 `t=duration` 的姿态一致 |
| 旋钮在求值时生效 | 夸张度、速度是 `knobs` 参数，不改动作谱本身，所以调节零延迟且不调用 AI |
| 果冻余震 | 作为求值后的统一后处理，对整体运动做弹性滞后。为保证确定性，用解析式弹簧而不是逐帧积分 |
| 形变在顶点着色器里做 | 挤压、弯曲、扭转对任意网格生效，不需要骨骼 |

### 5.4 首版动作词汇表

| 层 | 动作 |
| --- | --- |
| 整体运动 | `bounce` `spin` `shake` `nod` `tilt` `fly_out` `drop_in` `fall_over` |
| 形变 | `squash` `stretch` `inflate` `bend` `twist` `tremble` |
| 镜头 | `punch_in` `screen_shake` `dutch` |
| 特效贴纸 | `sweat` `question` `heart` `dark_lines` `speed_lines` `impact` |
| 字幕样式 | `slam` `shake` `pop` |

## 6. GIF 导出

| 环节 | 做法 |
| --- | --- |
| 取帧 | 不录屏。按固定时间步逐帧调用 `evaluate` 并渲染到离屏目标，读回像素。结果与机器性能无关 |
| 帧率 | 默认 20 fps。GIF 的帧延迟以 10 毫秒为单位，过短的延迟会被浏览器钳制 |
| 调色板 | 全片共用一张调色板，避免帧间颜色闪烁 |
| 透明底 | GIF 只有 1 位透明度，边缘会有锯齿。提供"衬底色"选项，让边缘向指定背景色过渡；卡通描边本身也能遮住边缘 |
| 编码 | `gifenc` 在 Web Worker 里运行，不阻塞界面 |
| 平台预设 | 每个预设是"尺寸 + 体积预算"。超出预算时依次降低帧率、颜色数、尺寸。各平台的具体限制在 M4 逐一核实，不凭印象写死 |

## 7. 应用框架与工程

### 7.1 框架

选 Next.js，原因有两个：

- 需要两个代理路由来保管密钥，Next.js 让页面和路由在同一个工程里部署。
- libfx 文档说明 Next.js 会只复制用到的 `.wasm` 文件，接入成本最低。

工作室页面是纯客户端组件，不使用服务端渲染。

### 7.2 目录规划

```
src/
├─ app/                 页面与 /api 代理路由
├─ stage/               three.js 舞台、材质、形变着色器
├─ score/               动作谱类型、校验、求值器、动作词汇表
├─ director/            fx 适配层、提示词、工具定义
├─ model/               ModelProvider 接口与 Tripo 实现
├─ export/              取帧、GIF 编码 Worker、平台预设
├─ store/               zustand 状态与 IndexedDB 仓库
└─ ui/                  四幕界面组件
```

依赖方向：`ui → director / stage / export → score`。`score` 不依赖任何其他模块，也不依赖 three.js，可以脱离浏览器测试。

### 7.3 测试

| 对象 | 方式 |
| --- | --- |
| 动作谱求值、校验、循环性 | Vitest 单元测试 |
| 每个动作词 | 性质测试：片段结束时回到静止姿态 |
| 导出 | 固定动作谱导出的帧数、尺寸、体积断言 |
| 导演 | 不做自动化断言。准备一组固定的情绪词，人工评审输出 |

## 8. M0 技术验证清单

以下三项是全案的地基，任何一项不成立都需要回到本文档改方案。

| 编号 | 验证内容 | 通过标准 |
| --- | --- | --- |
| V1 | 在 Next.js 页面里跑起 fx Agent，注册一个返回画布截图的工具，模型请求走后端代理 | 模型能描述截图内容；浏览器网络面板里看不到密钥 |
| V2 | 经后端代理调用 Tripo，从一张图得到 GLB 并加载到 three.js | 端到端耗时可接受；模型带贴图；记录实际耗时与单次成本 |
| V3 | 对任意网格做顶点着色器挤压形变，离屏逐帧渲染，导出透明底 GIF | GIF 无缝循环；边缘无明显杂边；体积在预期范围 |

同时在 M0 记录：fx 在 Chrome、Safari、Firefox、移动端浏览器上的实际可用性；导演使用的具体模型型号（需要支持图片输入，通过环境变量配置）。

## 9. 安全与合规

- 两个上游的密钥只存在于后端环境变量中。
- 代理路由按 IP 限流，并限制上传图片的大小与类型。
- 不执行模型生成的任何代码；动作谱经 JSON Schema 校验后才进入求值器。
- 上传的图片会发送给第三方生成服务，界面上明确告知。

## 10. 资料来源

本文档中关于 fx 和 Tripo 的事实来自 2026-11-16 的查阅，两者都在快速变化，以 M0 实测为准。

- fx 仓库：https://github.com/vercel-labs/fx
- fx 官网与文档：https://fx.sh/ · https://fx.sh/docs/lib
- libfx WebAssembly 指南：https://fx.sh/docs/lib/webassembly
- libfx 工具：https://fx.sh/docs/lib/tools
- libfx 图片：https://fx.sh/docs/lib/images
- libfx 提示与流式：https://fx.sh/docs/lib/prompts
- Tripo 开发者文档：https://developers.tripo3d.ai/en/docs
- Tripo 绑骨：https://developers.tripo3d.ai/en/docs/animations-rig
- Tripo 动作重定向：https://developers.tripo3d.ai/en/docs/animations-retarget
