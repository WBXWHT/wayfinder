# Research Notes

Research date: 2026-09-07
Status: historical design and implementation research. Current product
contracts live in [README.md](README.md), [docs/COMPANION.md](docs/COMPANION.md),
and [docs/PUBLISHING.md](docs/PUBLISHING.md).

## Open-Water Navigation Map Art Direction

The previous editorial botanical lineage was rejected after real-data review:
thin gray stems, black labels, and clipped titles made it resemble a specimen
sheet or rough working paper. A first spring-growth prototype fixed the color
and title problems, but the plant still framed decisions as passive growth. The
final direction is an open-water navigation map: decisions create visible
wakes across a broad ocean, while failed routes remain useful discoveries.

- Duolingo's learning path demonstrates that a gently winding route, large
  circular progress nodes, one obvious current step, and short descriptive
  labels make a long history feel approachable rather than technical.
  `https://blog.duolingo.com/new-duolingo-home-screen-design/`
- Name2Tree demonstrates deterministic organic shapes and a visible grow
  animation, but its black ink and paper aesthetic was rejected because it
  repeats the visual problem reported in Wayfinder.
  `https://github.com/pearmini/name2tree`
- GitGarden maps commits to visible growth. Its useful lesson is that the visual
  metaphor must correspond to real progress rather than be ambient decoration.
  `https://github.com/ezraaslan/GitGarden`
- ChatTree validates active-path highlighting, direct node navigation, search,
  and collapsing long conversational branches.
  `https://github.com/guoy0701/ChatTree`
- Game skill-tree interfaces make progression understandable by grouping nodes
  into a small number of colored pillars, emphasizing one next step, and using
  shape as well as color for state.
- Adventure and skill-path interfaces use checkpoints, an obvious current
  position, and short labels to make progress motivating without requiring a
  legend. Wayfinder keeps real branching instead of forcing one linear route.

Applied rules:

```text
task = shoreline departure
current lineage = visible wake
shared trunk = muted teal
route identities = blue / violet / gold
later routes = repeat those colors with a new channel pattern
success = green node and channel with check
failure = coral node and channel with cross
unreviewed = route-colored ring with neutral center
current session = route-colored sailboat with breathing ring
```

The sidebar starts at a top shoreline and sails downward; the full map starts
at a left shoreline and sails toward open water. Pale current lines and open
space create atmosphere without obscuring the graph. Every session has a
semantic `shortTitle` generated before rendering. The original prompt remains
available in details and search, while visual nodes never use ellipses or blind
CSS truncation.

## Editorial Sticker System And Project Paging

The nautical structure uses a VOX-inspired editorial paper-cut system rather
than kawaii stickers, glossy 3D badges, or a full scrapbook interface.

- VOX-style motion explainers consistently combine flat paper shapes, clear map
  annotations, deliberate cutout edges, and a restrained layer stack. Their
  value is explanatory hierarchy, not decoration.
  `https://www.parker.mov/tools/editologica/vox-style-explainer`
  `https://mapimator.com/blog/how-to-replicate-vox-style-map-animations`
- `Anil-matcha/vox-ai-motion-graphics-generator` shows how a small vocabulary
  of labeled objects, camera framing, and motion can preserve an editorial
  story without adding a dense UI.
  `https://github.com/Anil-matcha/vox-ai-motion-graphics-generator`
- Icons8's sticker guidance reinforces the small-size rule used here: one
  recognizable subject, a strong silhouette, a consistent white contour, and
  enough contrast to survive reduction.
  `https://blog.icons8.com/articles/sticker-ideas/`
- `holosticker` was reviewed for layered shine and border effects, but
  holographic distortion was rejected because it weakens route legibility.
  `https://github.com/jal-co/holosticker`
- Scrawl UI and scrapbook references were reviewed for hand-drawn character,
  but applying the treatment to every control was rejected. Wayfinder keeps
  native IDE controls and reserves the paper treatment for voyage objects and
  the project pager.
  `https://www.npmjs.com/package/scrawl-ui`

Applied sticker rules:

```text
paper object = flat fill + white die-cut contour + one offset shadow
route = white-edged shallow-water channel + route identity color
project = one ship that inherits its current route color
shared origin = the same lighthouse harbor on every project page
blocked route = coral channel + cross + reef silhouette
editor chrome = native IDE styling, not a decorative sticker
```

Projects are paged rather than stacked. The current project name, page count,
waypoint count, and turn count stay at the top; previous and next icon buttons
switch ships and clear project-scoped search and selection state. This avoids a
false visual relationship between independent projects and prevents a long
sidebar scroll from becoming project navigation.

Waypoint labels use progressive disclosure. The map shows only a semantic short
title and route-colored side tab; stage text, dates, turn counts, and original
content move into details. In the narrow sidebar, details open as a fixed bottom
Peek Sheet so selecting a waypoint never pushes or reflows the voyage. The wide
map retains its right-side inspector.

Routes use broad paper channels rather than thin graph edges. A white cut edge
and offset shadow make each channel read as a navigable waterway; a stable
branch color distinguishes alternatives until a user verdict overrides it with
green or red. Labels inherit a stable side from their nearest branching route,
and additional branches alternate into progressively outer left/right lanes.

## Route Color And Wayfinding

The palette now treats routes as qualitative categories instead of mapping
every stage and branch to a new hue.

- ColorBrewer separates qualitative schemes from ordered data. Routes are
  categories, so adding sequential stage colors creates false hierarchy and
  weakens identity.
  `https://colorbrewer2.org/learnmore/schemes_full.html`
  `https://colorbrewer2.org/index.html`
- The Bay Area's unified transit wayfinding work demonstrates a restrained
  three-color visual system supported by consistent labels and iconography
  rather than a different color for every concept.
  `https://mtc.ca.gov/news/bay-areas-new-look-transit-maps-and-signs-debut-fall`
- Accessible wayfinding and data-visualization guidance recommends redundant
  encoding: color should be paired with patterns, shapes, position, and direct
  labels so route recognition does not depend on hue alone.
  `https://colorarchive.org/guides/color-wayfinding-signage-guide/`
  `https://colorblind.io/guides/data-visualization`

Applied rules:

```text
shared trunk = muted teal
routes 0 / 3 = blue
routes 1 / 4 = violet
routes 2 / 5 = gold
route identity = channel + waypoint ring + card side tab
routes beyond three = reuse color, change pattern and lane
success = green only
failure = coral red only
stage = text in details, never a map color
```

This removes the competing stage-color system. Six channel patterns and stable
left/right lanes preserve distinction when colors repeat, while checks, crosses,
and reefs keep verdicts understandable without color.

The narrow sidebar uses hierarchical lanes rather than globally alternating
every new branch. Top-level routes alternate between inner and outer left/right
lanes. A nested branch inherits its parent's side: its first child continues on
the parent lane, while later siblings move outward. Nested routes fork shortly
after their parent waypoint and then run in parallel; extra vertical whitespace
separates top-level route families. This mirrors the wide map's clear fan-out
without forcing a horizontal canvas into the sidebar. Vertical transitions use
the same cubic-curve principle as the wide map, with long opposing control
handles that form continuous S turns instead of horizontal hooks and straight
drop segments.

## Experience Map Visualization

The full-size experience map uses a hybrid pattern instead of forcing a large
graph into the narrow activity-bar view:

- React Flow (`https://github.com/xyflow/xyflow`) provides mature node editing,
  pan, zoom, minimaps, and custom nodes under MIT, but adopting it would require
  React and a bundling layer in the current plain Webview architecture.
- Cytoscape.js (`https://github.com/cytoscape/cytoscape.js`) is a production
  graph-analysis toolkit with many layouts. Its network-first interaction model
  is broader and less predictable than Wayfinder's ordered decision paths.
- d3-hierarchy (`https://github.com/d3/d3-hierarchy`) provides deterministic
  hierarchy, circle-packing, and tree layouts under the ISC license without
  imposing a component framework.
- D3 partition and sunburst layouts were tested for compact hierarchy, but they
  weakened chronological direction and made causal continuation harder to
  trace, so they are retained only as rejected alternatives.
- Obsidian's Local Graph pattern keeps one known note at the center and limits
  the visible neighborhood. This is more useful for navigation than an
  unrestricted global graph:
  `https://github.com/giermarjores/obsidian-documentation/wiki/Using-the-Graph-View`.
- TheBrain (`https://www.thebrain.com/`) validates a focus-first knowledge
  model in which the current thought remains central while related context is
  arranged around it.
- Orcal UI's radial KnowledgeGraph
  (`https://github.com/asalik1/orcal-ui`) combines a centered hierarchy,
  semantic categories, zoom, and a synchronized detail panel.
- D3 knowledge-graph implementations such as
  `https://github.com/nirkhunan/knowledge-graph` use constellation layouts,
  neighborhood focus, search, and type-based node styling. Wayfinder keeps the
focus behavior but rejects a free-running force simulation so positions
  remain deterministic between visits.
- Branch Barber (`https://github.com/dingonewen/BranchBarber`) detects topic
  drift with synchronous TF-IDF followed by asynchronous MiniLM embeddings,
  persists parent-relative positions, and collapses runs of five or more normal
  turns. Its strongest reusable idea is separating fast provisional grouping
  from later semantic refinement.
- Claude Constellation
  (`https://github.com/Eburstz/claude-constellation`) treats sessions as the
  default visual unit, splits long sessions at four-hour idle gaps, and groups
  them with a k-nearest-neighbor graph plus label propagation. This supports
  session-level overview without turning every message into a global node.
- Atlas of Thought (`https://github.com/ijichi-art/atlas-of-thought`) uses an
  LLM-authored hierarchy and semantic map. Its spatial metaphor is memorable,
  but the procedural geography is too heavy for an IDE side panel.
- ChatTree (`https://github.com/guoy0701/ChatTree`) validates active-path
  highlighting, search, hover previews, and collapsing long linear segments.
- ChatTree's newer interaction guide
  (`https://github.com/MintCat98/ChatTree/blob/main/docs/USER_GUIDE.md`)
  makes branch decoration conditional: badges and dotted connectors appear only
  when another branch actually exists. Linear paths stay visually quiet.
- Git graph usability reports
  (`https://github.com/jesseduffield/lazygit/issues/5497`) show that optimizing
  lane reuse for compactness can make the actual divergence point ambiguous.
  Wayfinder therefore shows a branch rail only for a real retained alternative.
- Sensecape (`https://doi.org/10.1145/3586183.3606756`) and CanvasConvo
  (`https://arxiv.org/abs/2605.15848`) use multilevel abstraction and semantic
  zoom to keep long AI explorations understandable without exposing every
  message at once.
- The survey of unfoldable visualizations
  (`https://doi.org/10.1111/cgf.70152`) supports revealing detail in place while
  preserving surrounding context. Wayfinder uses the same pattern for collapsed
  exploration runs.
- Dep Graph's VS Code extension pattern keeps fast navigation in a sidebar and
  opens the full graph in an editor panel. Wayfinder adopts the same separation
  so the graph is never squeezed into a 280–380 px sidebar.
- MetroViz (`https://github.com/rstockm/Metroviz`) and DAG-map
  (`https://github.com/23min/DAG-map`) were evaluated for ordered history, but
  their continuous rails over-emphasize chronology for a product whose primary
  job is finding decisions and reusable experience.
- Git Graph+ (`https://github.com/the0807/git-graph-plus`) validates colored
  branch rails, a chronological reading direction, search, and a separate
  detail surface inside a VS Code Webview.
- Material data-visualization guidance recommends progressive disclosure and
  direct manipulation, with the chart chosen for the relationship being
  communicated rather than for decoration.

The resulting hierarchy remains:

```text
shared harbor -> project voyage page -> conversation session -> chronological turn
```

Topic, path, and lesson are not separate destinations. The task name is the
tree root, path is encoded by parent-child structure, and lessons attach to the
turn that produced them. The narrow sidebar renders a top-down voyage; the full
canvas renders the same current project horizontally with pan and zoom. Route
rings provide identity and orientation, while verdicts remain redundantly
encoded by green checks, coral crosses, neutral centers, and reefs.

## TRAE Integration

The first release uses only documented, stable integration surfaces:

- TraeCode can install local `.vsix` packages and extensions from the VS Code
  marketplace.
- Project hooks live at `$PROJECT_FOLDER/.trae/hooks.json`.
- `UserPromptSubmit` provides the prompt and session ID before execution.
- `PostToolUse` provides normalized tool names, inputs, and results.
- `Stop` provides the final assistant message at the end of a turn.

Primary sources:

- https://docs.trae.cn/ide/manage-extensions
- https://docs.trae.cn/ide/reference-for-hooks-configuration
- https://docs.trae.cn/ide/model-context-protocol

The extension does not scrape TRAE's UI or depend on the private layout of
`state.vscdb`. A community project proves that chat export from the database
is possible, but that format is not a stable public contract:

- https://github.com/yuanjing001/trae-chats-exporter

## Existing Projects

### Rewindo

Provides prompt-to-checkpoint pairing through `UserPromptSubmit` and `Stop`
hooks. Its append-only journal and Git-ref approach are good precedents.
It remains Claude Code-specific and presents a command-line timeline.

- https://github.com/utkarshranaa/rewindo

### Trace Your Code

Provides a VS Code webview, real file-system diffs, virtual documents, and a
separate Shadow Git repository. It is the closest extension architecture.
Its current adapters target Claude Code, Copilot, and Antigravity rather than
TRAE's official hooks.

- https://github.com/shreedharv16/Trace-Your-Code

### pi-rewind

Provides mature restoration safeguards: one checkpoint per turn, snapshot
deduplication, large-file exclusions, branch checks, and a before-restore
checkpoint. Its implementation targets the Pi agent rather than an IDE.

- https://github.com/arpagon/pi-rewind

### Variantree

Provides an explicit branch/checkpoint graph and retains conversation ancestry.
It proves the value of non-destructive branching, but the current product is
MCP-driven and does not distinguish machine validation from user judgment.

- https://github.com/NilotpalK/Variantree

### Cline

Provides a production reference for storing full workspace checkpoints in a
shadow Git repository without touching the user's normal Git history.

- https://docs.cline.bot/core-workflows/checkpoints
- https://github.com/cline/cline

### CLI Timeline and RECAP

Both validate the need to bind prompts to real code changes. CLI Timeline
focuses on browsing and reverting existing CLI logs; RECAP focuses on
research-grade capture and replay.

- https://marketplace.visualstudio.com/items?itemName=ayushagg31.cli-timeline
- https://arxiv.org/abs/2605.01104

## Product Gap Preserved

Wayfinder does not compete on rollback alone. It keeps two independent signals:

- machine evidence: validation passed, failed, timed out, or was not configured;
- human judgment: correct path, wrong path, and an optional lesson.

A restore creates a new path while the old future remains visible. This turns
failed attempts into retained experience instead of deleted history.
