import { useEffect, useState } from "react"
import { Button, Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle, Input, Separator, Switch, Tooltip, TooltipContent, TooltipTrigger, cn } from "@alexandernygard/components"
import { ArrowLeftIcon, ComponentIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { componentName, type ComponentDef, type DeckModel, type ElementNode } from "@ppt2/sdk"
import { FixedStage, SlideView } from "@ppt2/react"
import { componentSlide, elementAt, owned } from "../lib/tree"
import { useStore } from "../store"
import { dragProps, ElementPalette } from "./ElementPalette"
import { LayerTree } from "./LayerTree"

const CONTAINERS = new Set(["row", "column", "card"])
const findSlot = (el: ElementNode | undefined): ElementNode | undefined => !el ? undefined : el.type === "slot" ? el : el.children?.map(findSlot).find(Boolean)

/** The component drawn on its own, scaled to fit the card. */
function Preview({ deck, def }: { deck: DeckModel; def: ComponentDef }) {
  const slide = componentSlide(deck, def.name)
  if (!slide) return <div className="grid aspect-video place-items-center text-xs text-muted-foreground">No content</div>
  return (
    <FixedStage width={deck.width} height={deck.height} className="pointer-events-none">
      <SlideView deck={deck} slide={slide} />
    </FixedStage>
  )
}

/** A name field that commits on Enter or blur. */
function NameInput({ initial, placeholder, onCommit, onCancel, autoFocus }: { initial?: string; placeholder?: string; onCommit: (name: string) => void; onCancel?: () => void; autoFocus?: boolean }) {
  const [value, setValue] = useState(initial ?? "")
  useEffect(() => setValue(initial ?? ""), [initial])
  const commit = () => {
    const name = componentName(value)
    if (name && name !== initial) onCommit(name)
    else onCancel?.()
  }
  return (
    <Input
      autoFocus={autoFocus}
      value={value}
      placeholder={placeholder}
      className="h-8"
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setValue(initial ?? ""); onCancel?.(); e.currentTarget.blur() } }}
    />
  )
}

/**
 * The deck's components: reusable groups of elements. Each use renders the definition, with the use's
 * children in place of the <Slot />. Editing a component here changes every use.
 */
export function ComponentsPanel() {
  const deck = useStore((s) => s.deck)
  const editing = useStore((s) => s.editingComponent)
  const selected = useStore((s) => s.selected)
  const [creating, setCreating] = useState<null | "new" | "selection">(null)
  const [withSlot, setWithSlot] = useState(true)
  const st = useStore.getState
  if (!deck) return <p className="p-3 text-sm text-muted-foreground">Fix the code errors to see the deck's components.</p>

  const def = editing ? deck.components.find((c) => c.name === editing) : undefined
  if (editing && def) {
    const slot = findSlot(def.template)
    const slotIn = slot ? elementAt(deck, slot.path.split("/").slice(0, -1).join("/")) : undefined
    return (
      <div className="flex flex-col gap-4 p-3">
        <div className="flex items-center gap-2">
          <Button size="icon-sm" variant="ghost" aria-label="Back to components" onClick={() => st().editComponent(null)}><ArrowLeftIcon /></Button>
          <ComponentIcon className="size-4 text-violet-600" />
          <NameInput initial={def.name} onCommit={(name) => st().renameComponent(def.name, name)} />
        </div>
        <p className="text-xs text-muted-foreground">
          Changes here apply to {def.uses === 0 ? "every use (it isn't used yet)" : def.uses === 1 ? "its one use" : `all ${def.uses} uses`}.{" "}
          {slot ? <>Children of each use go into the <span className="font-medium text-violet-700 dark:text-violet-300">Slot</span>{slotIn ? ` in the ${slotIn.type}` : ""}. Drag it to move where they go.</> : <>It has no Slot, so uses can't have children. Drag a Slot from Elements into it.</>}
        </p>
        <section className="flex flex-col gap-1.5">
          <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Parts</h3>
          <div className="rounded-md border p-1"><LayerTree /></div>
        </section>
        <section className="flex flex-col gap-1.5">
          <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Elements</h3>
          <ElementPalette />
        </section>
        <Separator />
        <div className="flex gap-2">
          <Button size="sm" className="flex-1" onClick={() => st().editComponent(null)}>Done</Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <span><Button size="sm" variant="outline" disabled={def.uses > 0} onClick={() => st().deleteComponent(def.name)}><Trash2Icon /> Delete</Button></span>
            </TooltipTrigger>
            <TooltipContent>{def.uses > 0 ? "Remove its uses from the slides first" : "Delete this component"}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    )
  }

  const sel = selected && !selected.startsWith("c/") ? elementAt(deck, selected) : undefined
  const canMake = !!sel && owned(sel, undefined) && !sel.instance && sel.src != null

  return (
    <div className="flex flex-col gap-3 p-3">
      <p className="text-xs text-muted-foreground">Reusable parts. Drag one onto a slide; edit it once and every use changes. Its <span className="font-medium text-violet-700 dark:text-violet-300">Slot</span> is where each use's own content goes.</p>
      {creating ? (
        <div className="flex flex-col gap-2 rounded-lg border p-2">
          <div className="text-xs font-medium">{creating === "new" ? "New component" : `Make the selected ${sel?.type ?? "element"} a component`}</div>
          <NameInput autoFocus placeholder="Name, like Callout" onCancel={() => setCreating(null)} onCommit={(name) => {
            if (creating === "new") st().newComponent(name)
            else st().componentFromSelection(name, withSlot && CONTAINERS.has(sel?.type ?? ""))
            setCreating(null)
          }} />
          {creating === "selection" && CONTAINERS.has(sel?.type ?? "") && (
            <label className="flex items-center gap-2 text-xs"><Switch checked={withSlot} onCheckedChange={setWithSlot} size="sm" /> Add a slot for each use's own content</label>
          )}
        </div>
      ) : (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="flex-1" onClick={() => setCreating("new")}><PlusIcon /> New component</Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex-1"><Button size="sm" variant="outline" className="w-full" disabled={!canMake} onClick={() => setCreating("selection")}><ComponentIcon /> From selection</Button></span>
            </TooltipTrigger>
            <TooltipContent>{canMake ? "Turn the selected element into a component; it becomes the first use" : "Select an element on the slide first"}</TooltipContent>
          </Tooltip>
        </div>
      )}
      {deck.components.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><ComponentIcon /></EmptyMedia>
            <EmptyTitle>No components yet</EmptyTitle>
            <EmptyDescription>Make one from a card or row you want to reuse, or start a new one.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {deck.components.map((c) => (
            <div key={c.name} {...dragProps({ kind: "component", name: c.name }, c.name)} className={cn("group cursor-grab overflow-hidden rounded-lg border bg-card hover:border-violet-400 active:cursor-grabbing")}
              onDoubleClick={() => st().editComponent(c.name)}>
              <div className="border-b bg-muted/40"><Preview deck={deck} def={c} /></div>
              <div className="flex items-center gap-2 px-2 py-1.5">
                <ComponentIcon className="size-3.5 shrink-0 text-violet-600" />
                <span className="truncate text-sm font-medium">{c.name}</span>
                <span className="text-xs text-muted-foreground">{c.uses === 1 ? "1 use" : `${c.uses} uses`}</span>
                <Button size="xs" variant="ghost" className="ml-auto" onClick={() => st().editComponent(c.name)}><PencilIcon /> Edit</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
