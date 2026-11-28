import { File as NodeFile } from 'node:buffer';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { DirectorSettings } from '@/director/settings';

vi.mock('./ai-settings', () => ({ AiSettings: ({ onChange }: { onChange: (settings: DirectorSettings) => void }) => (
  <button onClick={() => onChange({ provider: 'openai-responses', model: 'gpt-5-mini', key: 'fixture' })}>配置测试模型</button>
) }));

const director = vi.hoisted(() => ({ design: vi.fn() }));
vi.mock('@/director/runtime', () => ({
  DirectorRuntime: class {
    static supported = async () => true;
    design = director.design;
    close() {}
  },
}));

it('replaces the dressing button with elapsed time and the actual stage until stopped', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('createImageBitmap', async () => ({ width: 32, height: 32, close() {} }));
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL() { return 'blob:fixture'; }
    static revokeObjectURL() {}
  });
  director.design.mockImplementation((_file: File, signal: AbortSignal) => (
    new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  ));
  try {
    const { Studio } = await import('./studio');
    await act(async () => root.render(<Studio />));
    const fileInput = host.querySelector<HTMLInputElement>('input[type=file]')!;
    const pngHeader = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    Object.defineProperty(fileInput, 'files', { value: [new NodeFile([pngHeader], 'test.png', { type: 'image/png' })] });
    await act(async () => fileInput.dispatchEvent(new Event('change', { bubbles: true })));
    const button = (name: string) => Array.from(host.querySelectorAll('button')).find(element => element.textContent?.trim() === name);
    expect(button('原画开拍')?.getAttribute('aria-pressed')).toBe('true');
    expect(button('生成模型并绑定骨骼')).toBeUndefined();
    await act(async () => button('实验性 3D')!.click());
    expect(button('生成模型并绑定骨骼')?.disabled).toBe(true);
    await act(async () => button('配置测试模型')!.click());
    await act(async () => host.querySelector<HTMLInputElement>('.model-controls input')!.click());
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
    await act(async () => button('生成模型并绑定骨骼')!.click());
    expect(button('生成模型并绑定骨骼')).toBeUndefined();
    expect(button('继续定妆')).toBeUndefined();
    expect(host.querySelector('.model-wait [role=status]')?.textContent).toContain('AI 导演正在分析');
    expect(host.querySelector('progress')?.hasAttribute('value')).toBe(false);
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(host.querySelector('time')?.textContent).toBe('已用 00:02');
    await act(async () => button('停止定妆')!.click());
    expect(host.querySelector('.model-wait')).toBeNull();
    expect(button('继续定妆')).toBeDefined();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
