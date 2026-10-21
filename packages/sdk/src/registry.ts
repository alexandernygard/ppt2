// Components defined while deck code runs. compile() collects them, so the
// model can list every component, used or not.

import type { Child } from "./runtime"

export interface ComponentInfo {
  name: string
  /** Offset of the component(…) call. */
  src?: number
  template: Child[]
  description?: string
}

let defined: ComponentInfo[] | null = null

export function define(info: ComponentInfo) {
  defined?.push(info)
}

/** Run `fn` and return the components it defined. */
export function collectComponents<T>(fn: () => T): { value: T; components: ComponentInfo[] } {
  const prev = defined
  defined = []
  try {
    const value = fn()
    return { value, components: defined }
  } finally {
    defined = prev
  }
}
