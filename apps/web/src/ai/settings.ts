import { create } from "zustand"

export const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
] as const

export type Effort = "low" | "medium" | "high"

interface Settings {
  apiKey: string
  model: string
  effort: Effort
  set: (s: Partial<Omit<Settings, "set">>) => void
}

const load = () => {
  try { return JSON.parse(localStorage.getItem("ppt2.settings") ?? "{}") } catch { return {} }
}

export const useSettings = create<Settings>()((set, get) => ({
  apiKey: "",
  model: "claude-opus-5-5",
  effort: "medium",
  ...load(),
  set(s) {
    set(s)
    const { apiKey, model, effort } = get()
    try { localStorage.setItem("ppt2.settings", JSON.stringify({ apiKey, model, effort })) } catch { /* ignore */ }
  },
}))
