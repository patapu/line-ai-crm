// [C] modules/line/delay.ts: a one-function module seam for the retry
// backoff sleeps in deliverQueuedMessage (docs/design.md section 10). Kept
// out of modules/line/service.ts so tests can
// `vi.mock('@/modules/line/delay')` and control the wait without real
// timers. service.ts must import this exactly as '@/modules/line/delay' so
// the mock path matches.

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
