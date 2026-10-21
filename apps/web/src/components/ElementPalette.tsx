import { Tooltip, TooltipContent, TooltipTrigger, cn } from "@alexandernygard/components"
import { ComponentIcon } from "lucide-react"
import { PALETTE, type PaletteItem } from "../lib/palette"
import type { DragItem } from "../lib/tree"
import { instanceCode, useStore } from "../store"

const GROUPS = ["Text", "Media", "Layout", "Diagrams", "Data", "Component"] as const

/** Start an in-app drag: the store knows what is dragged, so drop targets can check it while hovering. */
export function dragProps(item: DragItem, label: string) {
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData("text/plain", label)
      e.dataTransfer.effectAllowed = item.kind === "move" ? "move" : "copy"
      useStore.getState().setDragging(item)
    },
    onDragEnd: () => useStore.getState().setDragging(null),
  }
}

function Tile({ icon: Icon, label, hint, purple, onAdd, drag }: { icon: PaletteItem["icon"]; label: string; hint?: string; purple?: boolean; onAdd: () => void; drag: DragItem }) {
  const tile = (
    <button
      type="button"
      {...dragProps(drag, label)}
      onClick={onAdd}
      className={cn(
        "flex cursor-grab flex-col items-center gap-1 rounded-md border bg-card px-1 py-2 text-[11px] leading-tight hover:border-foreground/30 hover:bg-muted active:cursor-grabbing",
        purple && "border-violet-300 text-violet-700 dark:border-violet-500/50 dark:text-violet-300",
      )}
    >
      <Icon className="size-4" />
      <span className="w-full truncate">{label}</span>
    </button>
  )
  return (
    <Tooltip>
      <TooltipTrigger asChild>{tile}</TooltipTrigger>
      <TooltipContent side="left">{hint ?? `Drag onto the slide, or click to add`}</TooltipContent>
    </Tooltip>
  )
}

/** Everything you can add: drag a tile onto the slide (or into a container), or click it. */
export function ElementPalette() {
  const editing = useStore((s) => s.editingComponent)
  const components = useStore((s) => s.deck?.components ?? [])
  const disabled = useStore((s) => s.aiPreview != null)
  const st = useStore.getState
  const others = components.filter((c) => c.name !== editing)
  return (
    <div className={cn("flex flex-col gap-3", disabled && "pointer-events-none opacity-50")}>
      {GROUPS.map((group) => {
        const items = PALETTE.filter((p) => p.group === group && (p.type !== "slot" || editing))
        if (!items.length) return null
        return (
          <section key={group} className="flex flex-col gap-1.5">
            <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{group}</h3>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(68px,1fr))] gap-1.5">
              {items.map((p) => (
                <Tile key={p.type} icon={p.icon} label={p.label} hint={p.hint} purple={p.type === "slot"} drag={{ kind: "new", type: p.type, code: p.code() }} onAdd={() => st().addElement(p.type)} />
              ))}
            </div>
          </section>
        )
      })}
      {others.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Deck components</h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(68px,1fr))] gap-1.5">
            {others.map((c) => (
              <Tile key={c.name} icon={ComponentIcon} label={c.name} purple hint={c.description ?? `Use ${c.name}: drag onto the slide, or click to add`} drag={{ kind: "component", name: c.name }} onAdd={() => { const d = st().deck; if (d) st().insertCode(instanceCode(d, c.name)) }} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
