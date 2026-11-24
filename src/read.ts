// STUB on main. Owned by T1.
import type { AppConfig, LineRead } from './types';
export async function readLine(_jpeg: string, _cfg: AppConfig): Promise<LineRead> { throw new Error('not implemented'); }
export async function readLineInCloud(_jpeg: string, _cfg: AppConfig): Promise<LineRead> { throw new Error('not implemented'); }
export async function isOnDeviceAvailable(): Promise<boolean> { return false; }
export async function initDeviceModel(_onProgress: (pct: number) => void): Promise<void> { throw new Error('not implemented'); }
