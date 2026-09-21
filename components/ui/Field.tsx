// OWNER: lane A
import { cloneElement, Fragment, isValidElement, type ReactElement, type ReactNode } from 'react'

export interface FieldProps {
  label: string
  htmlFor: string
  error?: string
  children: ReactNode
}

interface DescribableProps {
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}

export function Field({ label, htmlFor, error, children }: FieldProps) {
  const errorId = `${htmlFor}-error`

  // Link the error message to its control for screen readers, but only when
  // children is a single valid element (so we never guess at multi-child
  // markup); the form components themselves stay untouched. A Fragment is
  // not a single control either, so skip it the same way.
  let control = children
  if (error && isValidElement(children) && children.type !== Fragment) {
    const element = children as ReactElement<DescribableProps>
    const existingDescribedBy = element.props['aria-describedby']
    control = cloneElement(element, {
      'aria-describedby': existingDescribedBy ? `${existingDescribedBy} ${errorId}` : errorId,
      'aria-invalid': true,
    })
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-sm font-semibold text-ink-2">
        {label}
      </label>
      {control}
      {error ? (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}
