/**
 * 帧调度数学（GIF 与 MP4 共用的纯函数）。
 *
 * GIF 延迟粒度为 10ms（厘秒），故先把 delay 取整到 10ms，再由 delay 反推帧数：
 * 总时长 ≈ loopSeconds，且循环缝无缝（t = loop 与 t = 0 画面等价的不变量
 * 由 scene 级单测保证，与 delay 取整无关）。
 *
 * 16fps → 62.5ms → 取整 60ms → 4000/60 ≈ 67 帧（有效 16.7fps，GIF 粒度所限）。
 *
 * MP4 不走量化延迟（时间戳是秒，无厘秒粒度），只共享同一时间轴约定
 * t ∈ [0, loop)；因此两条导出路径的画面在同一 t 上逐帧等价，
 * 但帧数**不必**相同（MP4 可用 30fps 而不受 GIF 的 10ms 粒度拖累）。
 */
export function frameDelayMs(fps: number): number {
  return Math.max(10, Math.round(1000 / fps / 10) * 10);
}

export function frameCount(fps: number, loopSeconds: number): number {
  return Math.max(1, Math.round((loopSeconds * 1000) / frameDelayMs(fps)));
}

/** 第 i 帧的时间参数（秒） */
export function frameTime(i: number, delayMs: number): number {
  return (i * delayMs) / 1000;
}

export interface ExportProgress {
  (done: number, total: number): void;
}
