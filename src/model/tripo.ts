import { ModelProvider } from "./provider";

/**
 * Tripo API v3 实现
 * 首版仅使用 /v3/generation/image-to-model。
 */
export class TripoProvider implements ModelProvider {
  async generate(image: Blob, signal?: AbortSignal): Promise<{ glb: Blob }> {
    // TODO(M0): 经 /api/model 上传图片并轮询任务结果
    void image;
    void signal;
    throw new Error("TripoProvider not implemented");
  }
}
