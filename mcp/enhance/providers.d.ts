import type { AiProviderConfig, AiProviderTestResult } from '../../src/types/ipc.types';
export interface GenerateRequest {
  image: Buffer;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  /** PNG, same size as image: transparent = regenerate, opaque = keep. */
  mask?: Buffer;
  prompt: string;
  size?: string;
  quality?: string;
}
export interface GenerateResult { buffer: Buffer; mime: string; width?: number; height?: number; model: string; note?: string }
export function providerSupportsMask(cfg: AiProviderConfig | null | undefined): boolean;
export function generateImage(cfg: AiProviderConfig, req: GenerateRequest): Promise<GenerateResult>;
export function testProvider(cfg: AiProviderConfig): Promise<AiProviderTestResult>;
