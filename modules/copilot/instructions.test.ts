import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PROMPT_VERSION, instructionsPath, loadInstructions } from '@/modules/copilot/instructions'

// [D] modules/copilot/instructions.test.ts (G4). No DB, no network. See
// S4-plan.md section G4.

describe('instructionsPath', () => {
  it('points at skills/crm-copilot/instructions.md', () => {
    expect(instructionsPath().replace(/\\/g, '/')).toMatch(/skills\/crm-copilot\/instructions\.md$/)
  })
})

describe('loadInstructions', () => {
  it('reads the same content as the file on disk', () => {
    const expected = readFileSync(instructionsPath(), 'utf8')
    expect(loadInstructions()).toBe(expected)
  })

  it('first line declares the current PROMPT_VERSION', () => {
    const firstLine = loadInstructions().split('\n')[0]
    expect(firstLine).toContain(`prompt-version: ${PROMPT_VERSION}`)
  })

  it('mentions every CopilotOutputSchema field name', () => {
    const text = loadInstructions()
    for (const field of ['summary', 'score', 'scoreReasons', 'nextBestAction', 'draftReply', 'confidence', 'flags']) {
      expect(text).toContain(field)
    }
  })

  it('mentions every output flag value', () => {
    const text = loadInstructions()
    for (const flag of [
      'INSUFFICIENT_CONTEXT',
      'PROMPT_INJECTION_SUSPECTED',
      'PRICING_REQUESTED',
      'COMPLAINT',
      'OUT_OF_SCOPE',
    ]) {
      expect(text).toContain(flag)
    }
  })

  it('mentions every next-best-action type', () => {
    const text = loadInstructions()
    for (const type of [
      'REPLY_LINE',
      'CALL',
      'SEND_PROPOSAL',
      'SCHEDULE_MEETING',
      'FOLLOW_UP_LATER',
      'MOVE_STAGE',
      'HANDOFF_TO_HUMAN',
      'CLOSE_LOST',
    ]) {
      expect(text).toContain(type)
    }
  })

  it('mentions every lead stage', () => {
    const text = loadInstructions()
    for (const stage of ['NEW', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST']) {
      expect(text).toContain(stage)
    }
  })
})
