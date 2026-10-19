// Keyframes for builds and transitions, injected once.
const CSS = `
@keyframes ppt2-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes ppt2-rise { from { opacity: 0; transform: translateY(40px) } to { opacity: 1; transform: none } }
@keyframes ppt2-zoom { from { opacity: 0; transform: scale(.92) } to { opacity: 1; transform: none } }
@keyframes ppt2-wipe { from { clip-path: inset(0 100% 0 0) } to { clip-path: inset(0 0 0 0) } }
@keyframes ppt2-slide-in { from { transform: translateX(6%); opacity: 0 } to { transform: none; opacity: 1 } }
.ppt2-anim-fade { animation: ppt2-fade .5s ease-out both }
.ppt2-anim-rise { animation: ppt2-rise .6s cubic-bezier(.2,.8,.2,1) both }
.ppt2-anim-zoom { animation: ppt2-zoom .5s cubic-bezier(.2,.8,.2,1) both }
.ppt2-anim-wipe { animation: ppt2-wipe .7s cubic-bezier(.6,0,.2,1) both }
.ppt2-transition-fade { animation: ppt2-fade .45s ease-out both }
.ppt2-transition-zoom { animation: ppt2-zoom .5s cubic-bezier(.2,.8,.2,1) both }
.ppt2-transition-slide { animation: ppt2-slide-in .5s cubic-bezier(.2,.8,.2,1) both }
`

if (typeof document !== "undefined" && !document.getElementById("ppt2-styles")) {
  const el = document.createElement("style")
  el.id = "ppt2-styles"
  el.textContent = CSS
  document.head.appendChild(el)
}

export {}
