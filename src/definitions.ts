import { registerPlugin } from '@capacitor/core';

export interface GemmaLocalPlugin {
  generateText(options: { prompt: string }): Promise<{ value: string }>;
}

const GemmaLocal = registerPlugin<GemmaLocalPlugin>('GemmaLocal');

export default GemmaLocal;
