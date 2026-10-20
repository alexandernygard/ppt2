import * as Lucide from "lucide-react"
import { icons, type LucideIcon } from "lucide-react"

const pascal = (name: string) => name.trim().replace(/(?:^|[-_\s]+)([a-z0-9])/gi, (_, c: string) => c.toUpperCase())
const kebab = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([a-zA-Z])(\d)/g, "$1-$2").replace(/(\d)x-(\d)/g, "$1x$2").toLowerCase()
const squash = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "")

/** Every icon by kebab-case name. The picker offers these, so each one must resolve back. */
const BY_NAME = new Map(Object.entries(icons as Record<string, LucideIcon>).map(([k, c]) => [kebab(k), c]))

/** Any spelling: "grid-2x2", "grid-2-x-2", "Grid2x2". */
const BY_SQUASHED = new Map(Object.entries(icons as Record<string, LucideIcon>).map(([k, c]) => [squash(k), c]))

/** Canonical kebab-case names of every icon, for pickers. */
export const ICON_NAMES: string[] = [...BY_NAME.keys()]

/** Look up a Lucide icon by kebab-case name. Also accepts PascalCase and Lucide's aliases ("bar-chart-3"). */
export function iconFor(name: unknown): LucideIcon | undefined {
  if (typeof name !== "string" || !name) return undefined
  const hit = BY_NAME.get(name.trim().toLowerCase()) ?? BY_SQUASHED.get(squash(name)) ?? (icons as Record<string, LucideIcon>)[pascal(name)] ?? (Lucide as unknown as Record<string, LucideIcon>)[pascal(name)]
  return hit && typeof hit === "object" ? hit : undefined
}
