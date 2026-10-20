import { describe, expect, it } from "vitest"
import { compile } from "./compile"
import { setProps, setText, moveSlide, insertSlide, removeSlide, duplicateSlide, insertElement, removeElement, applyEdits, PatchError, elementCode, replaceSlide } from "./patch"
import { STARTER_DECK } from "./starter"
import { lintDeck, outline, assetRefs } from "./outline"

const SRC = `import { Deck, Slide, Title, Text, List } from "ppt2"

// a comment that must survive
const items = ["a", "b"]

export default (
  <Deck title="Test" theme="paper">
    <Slide layout="title">
      <Title>Hello</Title>
      <Text>
        First line
        - bullet
      </Text>
    </Slide>
    <Slide>
      <Title size="lg">Second</Title>
      <List items={items} />
      {/* notes below */}
      <Text x={10} y={20}>Pinned</Text>
    </Slide>
    <Slide id="third" layout="statement">
      <Title>Third</Title>
    </Slide>
  </Deck>
)
`

const must = (src: string) => {
  const r = compile(src)
  if (!r.deck) throw new Error(r.errors.map((e) => e.message).join("\n"))
  return r.deck
}

describe("compile", () => {
  it("builds the deck model with source offsets", () => {
    const deck = must(SRC)
    expect(deck.title).toBe("Test")
    expect(deck.theme.name).toBe("paper")
    expect(deck.slides).toHaveLength(3)
    expect(deck.slides[0].elements[0]).toMatchObject({ type: "title", text: "Hello", path: "0/0" })
    expect(SRC.slice(deck.slides[0].src!, deck.slides[0].src! + 6)).toBe("<Slide")
  })

  it("keeps line breaks in text children, dedented", () => {
    const deck = must(SRC)
    expect(deck.slides[0].elements[1].text).toBe("First line\n- bullet")
  })

  it("evaluates code: variables, map and csv", () => {
    const deck = must(`import { Deck, Slide, Title, Chart, csv } from "ppt2"
const rows = csv\`k,v\nA,1\nB,2\`
export default <Deck>{["x", "y"].map((t) => <Slide><Title>{t}</Title><Chart data={rows} category="k" series="v" /></Slide>)}</Deck>`)
    expect(deck.slides.map((s) => s.elements[0].text)).toEqual(["x", "y"])
    expect(deck.slides[0].elements[1].props.data).toEqual([{ k: "A", v: 1 }, { k: "B", v: 2 }])
  })

  it("reports syntax errors with a location", () => {
    const r = compile(`export default <Deck><Slide></Deck>`)
    expect(r.deck).toBeUndefined()
    expect(r.errors[0].line).toBe(1)
  })

  it("warns about unknown layouts and themes without failing", () => {
    const r = compile(`export default <Deck theme="nope"><Slide layout="weird"><Title>x</Title></Slide></Deck>`)
    expect(r.deck?.slides[0].layout).toBe("content")
    expect(r.warnings.length).toBe(2)
  })

  it("compiles the starter deck cleanly", () => {
    const r = compile(STARTER_DECK)
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([])
    expect(r.deck!.slides.length).toBeGreaterThan(4)
    expect(outline(r.deck!)).toContain("Slide 1 [title]")
    expect(lintDeck(r.deck!).filter((d) => d.severity === "warning")).toEqual([])
  })
})

describe("patch round-trips", () => {
  it("sets, replaces and removes props surgically", () => {
    const deck = must(SRC)
    const pinned = deck.slides[1].elements[2]
    let out = setProps(SRC, pinned.src!, { x: 300, w: 640, y: undefined }).source
    expect(out).toContain(`<Text x={300} w={640}>Pinned</Text>`)
    expect(out).toContain("// a comment that must survive")
    const again = must(out).slides[1].elements[2]
    expect(again.props).toMatchObject({ x: 300, w: 640 })
    expect(again.props.y).toBeUndefined()
  })

  it("refuses to overwrite computed values", () => {
    const deck = must(SRC)
    const list = deck.slides[1].elements[1]
    expect(() => setProps(SRC, list.src!, { items: ["z"] })).toThrow(PatchError)
  })

  it("edits text and keeps the rest of the file byte-identical", () => {
    const deck = must(SRC)
    const title = deck.slides[0].elements[0]
    const out = setText(SRC, title.src!, "Hi {there} <you>").source
    expect(must(out).slides[0].elements[0].text).toBe("Hi {there} <you>")
    expect(out.replace(/<Title>.*?<\/Title>/, "")).toBe(SRC.replace(/<Title>Hello<\/Title>/, ""))
  })

  it("edits multi-line text in place", () => {
    const deck = must(SRC)
    const text = deck.slides[0].elements[1]
    const out = setText(SRC, text.src!, "One\nTwo\nThree").source
    expect(must(out).slides[0].elements[1].text).toBe("One\nTwo\nThree")
    expect(out).toContain("      <Text>\n        One\n        Two\n        Three\n      </Text>")
  })

  it("adds text to a self-closing element", () => {
    const src = `export default <Deck><Slide><Text color="muted" /></Slide></Deck>`
    const d = must(src)
    const out = setText(src, d.slides[0].elements[0].src!, "Now with text").source
    expect(out).toContain(`<Text color="muted">Now with text</Text>`)
  })

  it("moves slides and keeps comments with them", () => {
    const deck = must(SRC)
    const out = moveSlide(SRC, deck.src!, 2, 0).source
    const moved = must(out)
    expect(moved.slides.map((s) => s.elements[0].text)).toEqual(["Third", "Hello", "Second"])
    expect(out).toContain("// a comment that must survive")
    expect(moveSlide(out, moved.src!, 0, 2).source).toBe(SRC)
  })

  it("inserts, duplicates, replaces and removes slides", () => {
    let src = SRC
    src = insertSlide(src, must(src).src!, 1, `<Slide layout="section">\n  <Title>New</Title>\n</Slide>`).source
    expect(must(src).slides.map((s) => s.elements[0].text)).toEqual(["Hello", "New", "Second", "Third"])
    expect(src).toContain(`    <Slide layout="section">\n      <Title>New</Title>\n    </Slide>`)
    src = duplicateSlide(src, must(src).src!, 3).source
    expect(must(src).slides.map((s) => s.id)).toContain("third-copy")
    src = replaceSlide(src, must(src).src!, 0, `<Slide><Title>Replaced</Title></Slide>`).source
    expect(must(src).slides[0].elements[0].text).toBe("Replaced")
    src = removeSlide(src, must(src).src!, 1).source
    expect(must(src).slides.map((s) => s.elements[0].text)).toEqual(["Replaced", "Second", "Third", "Third"])
  })

  it("inserts and removes elements", () => {
    const deck = must(SRC)
    let src = insertElement(SRC, deck.slides[2].src!, elementCode("text", { color: "muted" }, "Added")).source
    expect(src).toContain(`      <Title>Third</Title>\n      <Text color="muted">Added</Text>\n    </Slide>`)
    const d2 = must(src)
    src = removeElement(src, d2.slides[2].elements[1].src!).source
    expect(src).toBe(SRC)
  })

  it("str_replace edits require a unique match", () => {
    expect(applyEdits(SRC, [{ old: "<Title>Third</Title>", new: "<Title>3</Title>" }])).toContain("<Title>3</Title>")
    expect(() => applyEdits(SRC, [{ old: "<Slide", new: "x" }])).toThrow(/more than once/)
    expect(() => applyEdits(SRC, [{ old: "nope", new: "x" }])).toThrow(/not found/)
  })

  it("flags template elements when editing inside a map", () => {
    const src = `export default <Deck>{["a"].map((t) => <Slide><Title size="lg">{t}</Title></Slide>)}</Deck>`
    const d = must(src)
    const r = setProps(src, d.slides[0].elements[0].src!, { size: "xl" })
    expect(r.template).toBe(true)
    expect(() => setText(src, d.slides[0].elements[0].src!, "x")).toThrow(PatchError)
    expect(() => moveSlide(src, d.src!, 0, 1)).toThrow(PatchError)
  })

  describe("diagrams, icons and assets", () => {
    const DIA = `import { Deck, Slide, Flow, Step, Tree, Node, Icon, Image } from "ppt2"

export default (
  <Deck>
    <Slide>
      <Flow>
        <Step icon="pencil">Draft</Step>
        <Step id="ok" kind="diamond" to="ship:Yes">Tests pass?</Step>
        <Step id="ship">Ship</Step>
        <Text>not allowed</Text>
      </Flow>
      <Icon name="rocket" />
      <Image src="assets/team.jpg" focus="40% 20%" />
    </Slide>
    <Slide background="assets/bg.png">
      <Tree>
        <Node sub="Ada">
          CEO
          <Node>CTO</Node>
          <Node>CFO</Node>
        </Node>
      </Tree>
      <Step>stray</Step>
    </Slide>
  </Deck>
)`

    it("normalizes diagram items and warns about misplaced ones", () => {
      const r = compile(DIA)
      const flow = r.deck!.slides[0].elements[0]
      expect(flow.type).toBe("flow")
      expect(flow.children!.map((c) => c.text)).toEqual(["Draft", "Tests pass?", "Ship"])
      expect(flow.children![1].props.to).toBe("ship:Yes")
      const tree = r.deck!.slides[1].elements[0]
      expect(tree.children![0].text).toBe("CEO")
      expect(tree.children![0].children!.map((c) => [c.path, c.text])).toEqual([["1/0/0/0", "CTO"], ["1/0/0/1", "CFO"]])
      expect(r.deck!.slides[1].elements).toHaveLength(1)
      expect(r.warnings.map((w) => w.message).join("\n")).toMatch(/can only contain <Step>[\s\S]*must be inside <Flow>/)
      expect(outline(r.deck!)).toContain("flow diagram: Draft → Tests pass? → Ship")
    })

    it("edits a tree node label without touching its children", () => {
      const d = compile(DIA).deck!
      const ceo = d.slides[1].elements[0].children![0]
      const out = setText(DIA, ceo.src!, "Chief executive").source
      expect(out).toContain(`<Node sub="Ada">
          Chief executive
          <Node>CTO</Node>`)
      const again = compile(out).deck!.slides[1].elements[0].children![0]
      expect(again.text).toBe("Chief executive")
      expect(again.children).toHaveLength(2)
    })

    it("adds a prop while changing or removing the last one", () => {
      const src = `export default <Deck><Slide><Image src="a" zoom={1.5} /></Slide></Deck>`
      const at = compile(src).deck!.slides[0].elements[0].src!
      expect(setProps(src, at, { focus: "80% 20%", zoom: 2 }).source).toContain(`<Image src="a" zoom={2} focus="80% 20%" />`)
      expect(setProps(src, at, { focus: "80% 20%", zoom: undefined }).source).toContain(`<Image src="a" focus="80% 20%" />`)
    })

    it("lists referenced assets", () => {
      expect(assetRefs(compile(DIA).deck!).sort()).toEqual(["bg.png", "team.jpg"])
    })
  })
})
