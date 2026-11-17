/**
 * fx Agent 适配层
 * 所有 libfx 调用收敛于此，界面与舞台不直接依赖 libfx。
 */

export interface DirectorRuntime {
  /** 占位：后续封装 createFxAgent、supportsJspi 检测与导演工具集 */
  _placeholder?: unknown;
}
