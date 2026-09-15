// OWNER: lane C (stub from layer 0)
//
// Signature frozen per docs/design.md section 4: `LINE_MODE=mock|live`,
// memoized per process. Lane C implements client.live.ts / client.mock.ts and
// wires this factory to them.

import { DomainError } from '@/lib/errors'
import type { LineClient } from '@/modules/line/types'

export function getLineClient(): LineClient {
  throw new DomainError('INTERNAL', 'not implemented')
}
