import type { KeyboardEvent } from 'react'

export function commitInputOnEnter(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
  const input = event.target
  if (!(input instanceof HTMLInputElement) || !['text', 'number'].includes(input.type)) return
  event.preventDefault()
  input.blur()
}
