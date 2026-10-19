import { createContext, useContext, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"

export const StageContext = createContext<{ scale: number }>({ scale: 1 })
export const useStage = () => useContext(StageContext)

/**
 * Fits a fixed-size canvas (default 1920×1080) into whatever space it's given,
 * preserving aspect ratio. Content renders at native resolution and is scaled
 * with a transform, so text and layout are identical at every size.
 */
export function Stage({ width = 1920, height = 1080, children, className, style, padding = 0 }: { width?: number; height?: number; children: ReactNode; className?: string; style?: CSSProperties; padding?: number }) {
  const outer = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = outer.current!
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const scale = size.w && size.h ? Math.min((size.w - padding * 2) / width, (size.h - padding * 2) / height) : 0
  return (
    <div ref={outer} className={className} style={{ position: "relative", overflow: "hidden", width: "100%", height: "100%", ...style }}>
      {scale > 0 && (
        <div
          style={{
            position: "absolute",
            width,
            height,
            left: (size.w - width * scale) / 2,
            top: (size.h - height * scale) / 2,
            transform: `scale(${scale})`,
            transformOrigin: "0 0",
          }}
        >
          <StageContext.Provider value={{ scale }}>{children}</StageContext.Provider>
        </div>
      )}
    </div>
  )
}

/** A stage sized by its width (for thumbnails and lists), keeping the aspect ratio. */
export function FixedStage({ width = 1920, height = 1080, children, className }: { width?: number; height?: number; children: ReactNode; className?: string }) {
  return (
    <div className={className} style={{ aspectRatio: `${width} / ${height}`, width: "100%" }}>
      <Stage width={width} height={height}>{children}</Stage>
    </div>
  )
}
