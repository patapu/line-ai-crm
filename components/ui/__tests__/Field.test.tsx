import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { Field } from '@/components/ui/Field'

// [tester] components/ui/__tests__/Field.test.tsx
// Covers S9's Field fix: aria-invalid and aria-describedby are only added
// to the child control when `error` is set, and an existing
// aria-describedby on the child is merged (not clobbered) rather than
// overwritten.

describe('Field aria wiring', () => {
  it('does not add aria-invalid or aria-describedby when there is no error', () => {
    const html = renderToString(
      <Field label="Name" htmlFor="name">
        <input id="name" name="name" />
      </Field>,
    )

    expect(html).not.toContain('aria-invalid')
    expect(html).not.toContain('aria-describedby')
  })

  it('adds aria-invalid and aria-describedby pointing at the error id when error is set', () => {
    const html = renderToString(
      <Field label="Name" htmlFor="name" error="Required">
        <input id="name" name="name" />
      </Field>,
    )

    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('aria-describedby="name-error"')
    expect(html).toContain('id="name-error"')
    expect(html).toContain('Required')
  })

  it('merges with an existing aria-describedby instead of replacing it', () => {
    const html = renderToString(
      <Field label="Name" htmlFor="name" error="Required">
        <input id="name" name="name" aria-describedby="name-hint" />
      </Field>,
    )

    expect(html).toContain('aria-describedby="name-hint name-error"')
  })

  it('leaves an existing aria-describedby untouched when there is no error', () => {
    const html = renderToString(
      <Field label="Name" htmlFor="name">
        <input id="name" name="name" aria-describedby="name-hint" />
      </Field>,
    )

    expect(html).toContain('aria-describedby="name-hint"')
    expect(html).not.toContain('name-hint name-error')
    expect(html).not.toContain('aria-invalid')
  })

  it('renders a Fragment child untouched, without injecting aria props onto it', () => {
    const html = renderToString(
      <Field label="Group" htmlFor="group" error="Required">
        <>
          <input id="group-a" name="group-a" />
          <input id="group-b" name="group-b" />
        </>
      </Field>,
    )

    expect(html).toContain('id="group-a"')
    expect(html).toContain('id="group-b"')
    expect(html).not.toContain('aria-invalid')
    expect(html).not.toContain('aria-describedby')
    // The error message itself still renders.
    expect(html).toContain('Required')
  })

  it('still clones a normal (non-Fragment) element child to add the aria props', () => {
    const html = renderToString(
      <Field label="Group" htmlFor="group" error="Required">
        <input id="group-a" name="group-a" />
      </Field>,
    )

    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('aria-describedby="group-error"')
  })
})
