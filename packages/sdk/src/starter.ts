export const STARTER_DECK = `import { Deck, Slide, Title, Subtitle, Text, List, Image, Chart, Stat, Quote, Row, Card, Shape, Notes, csv } from "ppt2"

// Data lives next to the slides that use it.
const growth = csv\`
quarter,revenue,costs
Q1,1.2,0.9
Q2,1.8,1.1
Q3,2.6,1.3
Q4,3.4,1.5
\`

export default (
  <Deck title="ppt2" theme="midnight">
    <Slide layout="title">
      <Title>Presentations as code</Title>
      <Subtitle>Declarative slides, built for humans and AI</Subtitle>
      <Text size="sm" color="muted">ppt2 · prototype</Text>
      <Notes>
        Open with the idea: a deck is a program you can read, diff and generate.
      </Notes>
    </Slide>

    <Slide layout="two-column">
      <Title>Code is the source of truth</Title>
      <List
        items={[
          "Edit visually: text, position, order, theme",
          "Every edit becomes a minimal code patch",
          "Comments and formatting survive",
        ]}
      />
      <Card>
        <Text size="lg" font="mono">{"<Slide layout=\\"two-column\\">"}</Text>
        <Text color="muted">Layouts place content. Drag an element to pin it with x/y.</Text>
      </Card>
      <Notes>Show a drag on the canvas, then point at the diff in the code view.</Notes>
    </Slide>

    <Slide layout="grid" columns={3}>
      <Title>What changed this year</Title>
      <Stat value="3.4M" label="Q4 revenue" delta="+31% QoQ" />
      <Stat value="62%" label="Gross margin" delta="+8 pts" />
      <Stat value="14d" label="Time to first deck" delta="-60%" />
      <Notes>Three numbers. Pause after each one.</Notes>
    </Slide>

    <Slide layout="content" transition="fade">
      <Title>Revenue is outrunning costs</Title>
      <Chart type="bar" data={growth} category="quarter" series={["revenue", "costs"]} unit="M" legend />
      <Notes>Costs grew 66% while revenue almost tripled.</Notes>
    </Slide>

    <Slide layout="image-right">
      <Image src="https://picsum.photos/seed/fjord/1200/1200" alt="A fjord at dawn" />
      <Title>Built for the way teams work</Title>
      <Text>
        Decks live in **git**, review like code,
        and regenerate from data.
      </Text>
      <Text step={1} animate="rise" color="accent">Ask the AI to restyle, tighten or chart anything.</Text>
      <Notes>The accent line appears on the first click.</Notes>
    </Slide>

    <Slide layout="quote" variant="inverse">
      <Quote by="Every presenter, ever">I just want to move this box a little to the left.</Quote>
      <Shape kind="ellipse" fill="accent" opacity={0.15} x={1500} y={-120} w={560} h={560} />
      <Notes>You still can. And the code stays clean.</Notes>
    </Slide>
  </Deck>
)
`
