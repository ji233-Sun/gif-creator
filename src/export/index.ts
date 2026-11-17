/**
 * GIF 导出
 * 逐帧离屏渲染 → 调色板量化 → Web Worker 编码
 */

export async function exportGif(): Promise<Blob> {
  // TODO(M1): 按动作谱与时间步取帧
  // TODO(M1): 在 Web Worker 中调用 gifenc 编码
  throw new Error("exportGif not implemented");
}
