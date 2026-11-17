---
name: paji-ui
description: 在啪叽 Paji（gif-creator）中创建、修改或审查前端页面时使用，尤其是 UI SDK 接入、统一粉蓝动漫风格、组件状态、角色预览、上传、情绪控件、弹窗、键盘可访问性及手机适配。保持 ui-sdk.dev 的官方交互行为和项目片场隐喻，防止误引入同名库或替换为 Radix；业务链路开发同时使用 paji-development。不用于其他项目的通用 UI 设计。
---

# Paji 界面维护

## 读取实际界面

定位仓库根目录并读取 [AGENTS.md](../../../AGENTS.md)。入口为 `src/app/page.tsx`，交互在 `src/ui/studio.tsx`，CSS 示例演员在 `src/ui/mascot.tsx`；全局样式在 `src/app/globals.css`，Tailwind 色阶在 `tailwind.config.ts`。

先运行现有页面，观察受影响的布局、状态和调用链，再进行修改。全局样式可能影响导航、上传区、示例卡片、预览和弹窗，不只检查当前控件。

## 复用已选定的 SDK

本项目的 UI SDK 指 https://ui-sdk.dev/，包为 `@ui-sdk/react` 和 `@ui-sdk/core`。目前两者精确锁定在 `0.1.0-beta.5`，React 为 19，TypeScript 的 React 类型需要满足该版本的 peer dependency。

- 按组件子路径导入，不从 `@ui-sdk/react` 根路径导入。
- 已使用 Button、Tabs、Slider、Switch、Dialog；在需要对应行为时优先复用它们。简单语义结构继续使用原生 HTML。
- SDK 提供行为，项目 CSS 提供视觉；不要把引入组件等同于已经统一样式。
- 保留 SDK 的状态、事件、键盘操作和焦点管理，使用受控 props 连接 React 状态，避免绕过组件自行改 DOM。
- Tabs 用 `TabsList`、`TabsTab`、`TabsPanel` 配对 value，并命名列表；Slider 用 Control、Track、Indicator、Thumb 组合，并为 Thumb 命名。
- Switch 用 `checked` / `onCheckedChange`；Dialog 具备标题、描述与关闭操作，关闭后返回触发器焦点。
- 官方默认样式 `@ui-sdk/core/web.css` 是可选项，当前项目通过自己的 CSS 完成样式。未经核对不要叠加全局默认皮肤或照抄 Tailwind 4 接入方式。

API 不确定时查阅对应版本的 `node_modules/@ui-sdk/react/dist/*.d.ts` 及官方文档：

- https://ui-sdk.dev/docs/react/installation
- https://ui-sdk.dev/docs/react/components/tabs
- https://ui-sdk.dev/docs/react/components/slider
- https://ui-sdk.dev/docs/react/components/switch
- https://ui-sdk.dev/docs/react/components/dialog

不要混淆 Vercel AI SDK、Radix 或名为 `ui-sdk` 的其他 npm 包。只有任务明确要求升级时才改变 SDK 版本，并同步 core、react 与 lockfile。

## 统一视觉语言

| 角色 | 当前基准 | 应用 |
| --- | --- | --- |
| 主色 | `--pink: #f36b99` | 主要动作、当前选项、品牌和强调 |
| 主色文字 | `--pink-deep: #c83c71` | 浅粉背景上的强调文字 |
| 辅色 | `--blue: #58b6e1` | 预览、提示、焦点和辅助动作 |
| 辅色文字 | `--blue-deep: #287fa9` | 浅蓝背景上的文字 |
| 画布与面板 | `--background: #f9fafc`、`--surface: #ffffff` | 奶白画布、白色卡片 |
| 正文 | `--foreground: #343747` | 有层次的深色内容 |

以现有变量为准，新增颜色先判断是否可复用语义变量；改动主题时同步 CSS 与 Tailwind。粉蓝配色只是参考气质，不复制 B 站标识或素材。

沿用圆角卡片、细边框、柔和阴影、轻量网格、胶带便签和漫画对白；装饰服务于角色与操作，不让每个区域都变成高饱和渐变。保持按钮、图标尺寸、间距、选择态、hover 和 focus 一致。

使用 `lucide-react` 图标，装饰图形不抢占可访问名称，纯图标按钮需要可读标签。中文文案使用「片场、演员、导演、小情绪」，避免把底层实现细节塞进普通创作流程。

## 维护真实的交互状态

当前演示中的内置演员为 `bunny`、`cat`、`slime`，情绪为 `happy`、`speechless`、`crazy`；戏精指数为 0–11。CSS 动效是本地示例，并非 three.js 或 AI 生成结果。

- 图片仅支持 PNG、JPEG、WebP，限制 10 MiB；验证类型、大小和解码失败。
- 使用本地 Blob URL 预览，替换、移除和卸载时释放资源；无效的新选择应保留仍有效的上一张图。
- 同时维护未选择、拖放中、已选择、错误、示例预览和上传原图预览。
- 示范角色切换可回到示例预览，移除上传图也恢复示例；控件行为应与当前预览类型一致。
- 作品页仍是空态；AI 建模、导演、作品保存和 GIF 导出未接通时不要生成假记录或假完成提示。
- 接通真实图片上传前同步更改「只在本地预览」提示，说明第三方处理边界，并结合 [功能开发 Skill](../paji-development/SKILL.md) 完成服务端验证。

## 浏览器验收

先执行适用的类型和静态检查；UI 变动还需启动服务、进入页面并操作功能，不能只依据编译结果。

```sh
pnpm exec tsc --noEmit
pnpm exec eslint src tailwind.config.ts
pnpm dev
```

对受影响的行为执行以下检查，不为纯装饰改动引入只重复实现的单元测试：

1. 检查桌面双栏、平板布局、手机堆叠；至少覆盖 1440px、768px、390px，涉及导航或宽度限制时再检查 320px。
2. 确认页面无横向溢出、文字截断不妨碍操作、弹窗在短屏下可滚动，并查看控制台异常。
3. 操作示例角色和情绪切换；验证 Tabs 方向键、Slider 的 Home / End / 方向键、Switch 的空格、暂停与恢复。
4. 关闭字幕后确认实际预览消失；弹窗按 Escape 可关闭且焦点返回触发器；`prefers-reduced-motion` 下停止装饰动画。
5. 上传改动检查正常文件、替换、移除、错误类型、超限、损坏图片和拖放；本地预览阶段不能产生图片上传请求。
6. 复查作品空态、返回片场和指南，不只检查视觉改动位置。

适当截图并查看画面；调整视口后等待页面布局稳定再截图。完成浏览器验收后清理自己生成的临时日志，不把测试截图、缓存、浏览器 profile 或个人环境路径提交进仓库。

生产构建前停止自己启动且使用相同 `.next` 的开发服务；独立生产预览按根 AGENTS.md 的 standalone 流程运行。报告实际验证范围，无法操作浏览器时明确说明限制。
