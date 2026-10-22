import { Tabs, TabsContent, TabsList, TabsTrigger } from "@alexandernygard/components"
import { ComponentIcon, LayersIcon, SparklesIcon } from "lucide-react"
import { useStore, type SidebarTab } from "../store"
import { ChatPanel } from "./ChatPanel"
import { ElementPalette } from "./ElementPalette"
import { LayerTree } from "./LayerTree"
import { ComponentsPanel } from "./ComponentsPanel"

/** The right sidebar: the AI co-author, the slide's layers, and the deck's components. */
export function RightSidebar({ onNeedKey }: { onNeedKey: () => void }) {
  const tab = useStore((s) => s.sidebarTab)
  const editing = useStore((s) => s.editingComponent)
  return (
    <Tabs value={tab} onValueChange={(t) => useStore.getState().setSidebarTab(t as SidebarTab)} className="@container flex h-full min-h-0 flex-col gap-0">
      <div className="flex h-11 shrink-0 items-center border-b px-2 in-data-[mobile=true]:pr-12">
        <TabsList className="w-full">
          <TabsTrigger value="assistant" title="Assistant"><SparklesIcon /><span className="hidden @[22rem]:inline">Assistant</span></TabsTrigger>
          <TabsTrigger value="layers" title="Layers and elements"><LayersIcon /><span className="hidden @[22rem]:inline">Layers</span></TabsTrigger>
          <TabsTrigger value="components" title="Components"><ComponentIcon /><span className="hidden @[22rem]:inline">Components</span></TabsTrigger>
        </TabsList>
      </div>
      {/* forceMount keeps the chat's scroll position and draft while other tabs are open. */}
      <TabsContent value="assistant" forceMount className="min-h-0 flex-1 data-[state=inactive]:hidden">
        <ChatPanel onNeedKey={onNeedKey} />
      </TabsContent>
      <TabsContent value="layers" className="min-h-0 flex-1">
        <div className="h-full overflow-y-auto">
          <div className="flex flex-col gap-4 p-3">
            <section className="flex flex-col gap-1.5">
              <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{editing ? `${editing} parts` : "Layers"}</h3>
              <LayerTree />
            </section>
            <section className="flex flex-col gap-1.5 border-t pt-3">
              <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Add elements</h3>
              <ElementPalette />
            </section>
          </div>
        </div>
      </TabsContent>
      <TabsContent value="components" className="min-h-0 flex-1">
        <div className="h-full overflow-y-auto"><ComponentsPanel /></div>
      </TabsContent>
    </Tabs>
  )
}
