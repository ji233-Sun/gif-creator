/**
 * 图生 3D 服务抽象接口
 * 舞台和导演只依赖此接口，不依赖具体服务商。
 */

export interface ModelProvider {
  generate(image: Blob, signal?: AbortSignal): Promise<{ glb: Blob }>;
}
