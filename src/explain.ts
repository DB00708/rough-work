// STUB on main. Owned by T4.
import type { AppConfig, Explanation } from './types';
export interface ExplainInput { prev: string; next: string; prevCrop?: string; nextCrop?: string }
export async function explainMistake(_input: ExplainInput, _cfg: AppConfig): Promise<Explanation> { throw new Error('not implemented'); }
