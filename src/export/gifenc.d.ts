declare module 'gifenc' {
  export function quantize(data: Uint8Array | Uint8ClampedArray, count: number, options?: { format?: 'rgb565' }): number[][];
  export function applyPalette(data: Uint8Array | Uint8ClampedArray, palette: number[][], format?: 'rgb565'): Uint8Array;
  export function GIFEncoder(): {
    writeFrame(index: Uint8Array, width: number, height: number, options: {
      palette?: number[][]; transparent: boolean; transparentIndex: number; delay: number; repeat: number; dispose: number;
    }): void;
    finish(): void;
    bytes(): Uint8Array<ArrayBuffer>;
  };
}
