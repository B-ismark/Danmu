# Needs eyes

Everything here typechecks, lints and passes tests. These are the things a green suite
cannot tell you: how a change looks, feels, sounds or behaves on a real device.

**Rules.**

- **It is a live list.** Once someone has looked at an item, delete it. Don't strike it
  through or archive it. It must not grow back.
- **Merging is not looking.** When a branch merges, its item stays. Re-point it at the merge
  commit on `main`, because a fix nobody has seen needs eyes more after it ships, not less.
- **Keep items short.** Each item is four lines: **Where** (the screen and clicks), **Wrong
  looks like**, **Needs** (any browser, a real GPU, a phone, touch, ears, a real scan) and
  **Rides** (the commit). History, measurements and lessons belong in the commit message,
  `docs/traps.md` or `docs/what-is-still-open.md`, not here.
- **Check what a headless browser can reach before writing it down for a person.** See
  *How to check* at the end. Anything a script can settle should be settled by the script.
- **No test renders geometry, and nothing below has been on a real GPU.** All the probing so
  far ran on headless Chromium with software rendering (SwiftShader). That says nothing
  about real lighting, real touch or a real phone.

---

## Sizes and fit

### Bed, fridge and dining table redraw at the size you type
- **Where:** Library → Bed: type width 900, press Enter; then 1800. Fridge: width 790, then 800. Dining table: width 2400. A photo scan with a double bed cut off at the photo's edge.
- **Wrong looks like:** a 900 bed with two pillows or two nightstands; fridge doors not meeting in the middle at 800 (one door below); fat legs on the long table; the scanned double coming back ~0.9 m wide.
- **Needs:** any browser (the scan half needs a real scan with photos).
- **Rides:** `28e1e03` (B-ismark/Danmu#212)

### Inspector header is one row; the placement card comes and goes
- **Where:** Any starter room → select bed, nightstand, its lamp, curtain, TV, a door; hover pieces in 3D. Narrow to 1024 px. Press Floor on a floating lamp.
- **Wrong looks like:** name and shelf not on one row (a short name's shelf wrapping; a long scanned name ellipsised behind it); a door shelved under *Appliances*, not *Openings*; a card on a bed on the floor / TV on the wall; lamp not saying *On Nightstand*; judge whether the rows below jumping when the card appears reads as a jump.
- **Needs:** any browser.
- **Rides:** `b5414e0` (B-ismark/Danmu#217)

### An old room's ceiling fan still hangs short of the slab
- **Where:** A room saved with a fan by an older build; add a second fan beside it. Then change the ceiling height by 1 cm and back.
- **Wrong looks like:** judge whether one flush fan beside one 30–55 mm short reads as a bug; after the ceiling nudge both should be flush.
- **Needs:** a browser with a room saved by an older build.
- **Rides:** `1d16087` (B-ismark/Danmu#88)

### A badly framed scan photo blames the photo, not its pieces
- **Where:** Photos → add four wall photos where one is shot close up from the foot of the bed, tilted down → Furniture → that wall's tab. Then narrow the window to phone width.
- **Wrong looks like:** no amber note above that photo; rows there still say "does not fit a bed"; the note or its Retake button squeezed or clipped at phone width; the note on a photo where most pieces did fit.
- **Needs:** any browser and a real off-centre photo (seen headless on a stock hotel photo only).
- **Rides:** this branch, before its PR merges

### A nightstand behind the bed reads its real size
- **Where:** Photos → a wall photo taken from the foot of a bed, with a nightstand beside the headboard whose legs the mattress hides → Furniture → that wall's tab, then the 3D model. Then, on the same tab: delete the bed, undo; draw a box by hand around the nightstand from the mattress up; rename the nightstand and look at what it offers; leave the screen and come back.
- **Wrong looks like:** that nightstand's row says it does not fit a nightstand, or it stands out in the middle of the bed in 3D; or a nightstand standing clear of the bed, legs in view, moving back to the wall when it was further out; a table lamp on the nightstand pushed back to the wall; the nightstand's size or chip changing when you leave and come back, or not changing when the bed is deleted; a hand-drawn nightstand reading wide and short.
- **Needs:** any browser and a real bedroom photo (checked headless on the seaview suite's ultrawide east wall only).
- **Rides:** this branch, before its PR merges

## Surfaces and textures

### Floor, wall, furniture and ceiling textures on a real GPU
- **Where:** Any room, Best looking and Smoother, Midday and Night: orbit low to see the ceiling, zoom on sofa and coffee table. Floor and Walls in the left rail: every material/finish, size, grout/mortar, dark and pale colours. Every Finish on a sofa, dining chair, door, mirror.
- **Wrong looks like:** seams or grout shimmering/moiré; visible repeat on floor, stone or a long brick wall; herringbone as stripes; marble veins as cracks; fabric darker than its swatch; ceiling too bright/dark on Best looking; velvet as plastic, lacquer with no reflection, half a piece finished; brick not starting at the wall's corner; the "Laying the new floor…" line flashing or never showing; a hitch on first open or first stone; rail buttons clipping at 1024–1279 px.
- **Needs:** real GPU (and a phone for the first-open hitch).
- **Rides:** `93e65aa` (B-ismark/Danmu#306)

### Click the floor to change it
- **Where:** 3D: still-click the floor, then orbit and return to the start before releasing; on a phone, tap the floor.
- **Wrong looks like:** judge whether an orbit that returns to its start selecting the floor bothers anyone; the floor's green edge hidden behind the near wall's cut-away; no Floor sheet on a phone tap.
- **Needs:** real phone (touch), any browser for the rest.
- **Rides:** `93e65aa` (B-ismark/Danmu#306)

## Drag and selection

*What is left needs a real GPU, a 3D-only gesture, touch, or a person reading a sentence.*

### No floor streak under a dragged bed; outlines keep their colours
- **Where:** Seeded bedroom, 3D: drag the bed slowly across its nightstands and back; select and hover pieces, select a wall, trigger a refused move.
- **Wrong looks like:** a dark band across the floor; a missing outline (bed legs, selection rim, wall frame); any outline drawn white instead of terracotta (selected), sage (hover), red (refused).
- **Needs:** real GPU.
- **Rides:** `bd88347` (B-ismark/Danmu#215)

### A lamp carried onto the other nightstand stays with it
- **Where:** Seeded bedroom, 3D Model: shift-click a floor piece and the left nightstand's lamp, drag until the lamp stands on the right nightstand; then drag the right nightstand alone. Repeat with one wheel notch just before release.
- **Wrong looks like:** the lamp left standing on air.
- **Needs:** any browser (3D tab).
- **Rides:** `e2b77f1` (B-ismark/Danmu#224)

### Move to the nearest wall / Put on the floor from the menu
- **Where:** 3D tab: right-click a sofa, then a TV or painting. 2D: Move to the nearest wall on the seeded Sofa; on Coffee table + Plant shift-selected away from walls; again with a piece blocking the Plant's spot; on a table lamp on a nightstand, then Put on the floor.
- **Wrong looks like:** rows missing from a sofa's 3D menu or present on a TV's; no *Nothing moved* toast, or one overflowing a phone; a set arriving with one piece turned; the lamp landing at nightstand height.
- **Needs:** any browser (phone width for the toast).
- **Rides:** `f7ec850` (B-ismark/Danmu#313)

### A cancelled drag leaves nothing marked as moved
- **Where:** Seeded bedroom, 3D Model: drag an untouched nightstand, Escape before release; select it, then its lamp. Then drag it for real.
- **Wrong looks like:** *Back to where it started* offered after the cancel, missing after the real drag, or a previously moved piece losing it.
- **Needs:** any browser (3D tab).
- **Rides:** `624bfda` (B-ismark/Danmu#229)

### A ring turn in 3D matches the plan
- **Where:** 3D Model, R for the ring: turn a piece ~240°, check 2D Plan; press the ring and release without turning (snap on and off); start a turn, Escape, keep moving, release.
- **Wrong looks like:** plan mirrored against 3D; a piece flipping or stepping onto the grid on a bare press; 3D still turning after Escape.
- **Needs:** any browser with a real mouse (the ring has no DOM).
- **Rides:** `e08e790` (B-ismark/Danmu#230)

### A fan dropped onto a fan moves aside; a bed set stops at the wardrobe
- **Where:** Drop a ceiling fan on 2D Plan, then a second on the same spot in 3D. Merge a bed with a nightstand and lamp each side; mouse-drag the set into a wardrobe.
- **Wrong looks like:** two fans sharing a hub or the second far away; no "spot taken" note; a nightstand on top of the wardrobe, a lamp sunk in its nightstand, or no size tag naming the stopper.
- **Needs:** any browser.
- **Rides:** `28e1e03` (B-ismark/Danmu#212)

### Change the model puts a floor piece beside the bed, a lamp on the desk
- **Where:** U-Shape: print above the headboard → Change the model… → Nightstand, Floor lamp, Armchair, Floor plant (undo between). Print above a desk → Table lamp.
- **Wrong looks like:** any piece inside the bed's outline in the plan or through the duvet in 3D; the table lamp not on the desk.
- **Needs:** any browser, both tabs.
- **Rides:** `6a7f93f` (B-ismark/Danmu#210), `502fb23` (B-ismark/Danmu#206)

### A refusal names the wall when the piece is wider than it
- **Where:** Rectangle 6 × 4: a 5 m curtain on a 6 m wall, drag it toward a 4 m wall in both tabs; focus it in the plan and arrow-turn it. Then a wardrobe in a normal curtain's way.
- **Wrong looks like:** "something is in the way" when nothing is (should say "it is wider than that wall"); the wardrobe case not saying "something is in the way".
- **Needs:** any browser.
- **Rides:** `32ccdca` (B-ismark/Danmu#200)

### How the turn report reads
- **Where:** Keyboard-turn a painting on a wall and refuse a sofa at 90°, with a screen reader on.
- **Wrong looks like:** the three-clause announcement (incl. a 0.02 m nudge) too long; the 500 ms red outline missed by the eye; "Nothing turned." reading as a fault.
- **Needs:** ears (screen reader) and eyes.
- **Rides:** `0a7b760` (B-ismark/Danmu#102)

### Second finger on the rotate ring mid-drag
- **Where:** Touch device: long-press a drawer unit, slide it, and put a second finger on the selected piece's ring while moving.
- **Wrong looks like:** the drawer stopping dead, or back at its start after a reload.
- **Needs:** touch (two fingers).
- **Rides:** `d2ef257` (B-ismark/Danmu#73)

### Placement banner with a screen reader
- **Where:** Screen reader on: select a piece, then drag it.
- **Wrong looks like:** more than one announcement on select, or chatter while dragging.
- **Needs:** ears (screen reader).
- **Rides:** `e0c484a` (B-ismark/Danmu#91)

## Layout and Ideas

*Owner: `layout`. Ideas, Fix and Try a fix, and how pieces sit together when the room is rearranged.*

### Ideas hands back square pieces, and still has ideas when a kept piece is at fault
- **Where:** any L-shaped preset → Ideas, three presses; then 4 × 3.5 Rectangle, drag the sofa into the doorway, keep it in place, open Ideas.
- **Wrong looks like:** a sofa, bed, table, rug or shelf a few degrees off square; an armchair at ~10°; "No ideas this time" or a refusal naming the kept sofa.
- **Needs:** any browser.
- **Rides:** `989d667` (B-ismark/Danmu#279)

### Ideas and Fix tidy up a room before giving up on it
- **Where:** T-Shape 6 × 5 and L-Shape 4.5 × 4 → Ideas, three presses; then heap every piece in the middle and press Fix a few times.
- **Wrong looks like:** pages that are the same room with one chair moved; a wardrobe in front of a radiator or window; a nightstand turned a few degrees; a press visibly slower than before.
- **Needs:** any browser.
- **Rides:** `d215305` (B-ismark/Danmu#280)

### Dining chairs tuck only square to the table and between its legs
- **Where:** Rectangle, 3D: push a chair turned 30° under the table, slide one into a corner leg, office chair against the desk's side panel, a chair into each arm of an L-desk, drop a chair from the Library under each long side of the table.
- **Wrong looks like:** a chair accepted through a leg or turned; a square chair refused; office chair not stopping at the panel; a dropped chair moved out on the side it faces, or moved silently.
- **Needs:** any browser.
- **Rides:** `28e1e03` (B-ismark/Danmu#212)

### A table and its chairs, and a bed and its nightstands, move as one set
- **Where:** Open Plan → Ideas, every page; T-Shape with the table knocked off square → Fix; U-Shape → Fix and Ideas; then pull one chair a metre away and press Ideas.
- **Wrong looks like:** a chair through the table, a set arriving a few degrees off, a nightstand left behind, the pulled-away chair dragged back.
- **Needs:** any browser.
- **Rides:** `0972aed` (B-ismark/Danmu#214)

### Ideas puts a seat on the floor, never on a table
- **Where:** Rectangle 6 × 4: ottoman dragged onto the coffee table with a small box on it → Ideas → press an idea card → Back; then keep the ottoman in place and look again.
- **Wrong looks like:** ottoman on, inside or floating over the table in a card; the box left behind; Back not restoring it; a kept ottoman that moved; a clean room told "Try Fix first".
- **Needs:** any browser.
- **Rides:** `6a4b45a` (B-ismark/Danmu#222)

### Ideas running dry with a group says to ungroup it
- **Where:** `t` 6 × 4: group the sofa and dining table → Ideas until it runs dry; keep the sofa in place and retry; then group the dining table with its chairs instead.
- **Wrong looks like:** "merged set" on screen; the ungroup sentence for the table-and-chairs group or a kept group; the sentence spilling past the card at 1024 px or on a phone.
- **Needs:** any browser, plus a phone width.
- **Rides:** `3d70896` (B-ismark/Danmu#220)

### Ideas and Fix keep the rug inside the walls
- **Where:** Open Plan and L-Shape → Ideas three times; drag the rug half past a wall → Room check → Try a fix; on 6 × 4, leave a rug 30 cm into a wall and press Fix and Ideas, pinned and unpinned; a 5 × 4 rug in a 4.8 × 3.8 room → Ideas.
- **Wrong looks like:** a rug edge through a wall you did not put it through; a rug jammed into one corner on every card; Try a fix that spins and finds nothing; a rug you left moved or turned; "No ideas this time".
- **Needs:** any browser.
- **Rides:** `2c4759f` (B-ismark/Danmu#185)

### A chair tucked under its table stays on the floor
- **Where:** T-Shape, both tabs: drag the dining set a hand's width; nudge a deeply tucked chair with an arrow key; change a table lamp at the table's edge into a Dining chair. 3D only: table at 1613 mm wide, drag it with Move, Turn and Scale.
- **Wrong looks like:** a chair seat level with the tabletop; a chair left behind; "Floating" on a chair that is on something; a lamp dropped on the table falling to the floor; the width reading 1610 afterwards, or 3D refusing a drag the plan allows.
- **Needs:** any browser.
- **Rides:** `150e57e` (B-ismark/Danmu#189)

### An office chair goes under a desk only where it clears
- **Where:** Rectangle: set the desk to 650 mm high and push the office chair under it; raise to ~690 mm and retry; run Fix and Ideas with an ottoman near the coffee table.
- **Wrong looks like:** the chair tucked under the 650 mm desk; refused at 690 mm; an ottoman sunk into the coffee table in any idea.
- **Needs:** any browser.
- **Rides:** `1be34c0` (B-ismark/Danmu#193)

### The Ideas gallery on a phone and a real GPU
- **Where:** any furnished room → Ideas (left rail; the Room sheet on a phone); press cards, Back to your room, heart, Kept in place, drag while open.
- **Wrong looks like:** the 3D room not matching the highlighted card or a dead press; placeholders or "Finding more…" that never stop; on a phone the card covering the bottom bar, captions cut mid-word, thumbnails too small; a filled heart for a deleted layout.
- **Needs:** real phone, real GPU.
- **Rides:** `6ff707f` (B-ismark/Danmu#159)

### Pieces drawn as the real objects
- **Where:** add each from the Library; orbit at eye level, low down and from behind; recolour; stretch to smallest and largest on each axis, widen the shoe rack and clothes rail; lock one. Pieces: standing fan; pillows, duvet and scatter cushions, sofa/armchair cushions, clothes rail, shoe rack, curtain; washing machine, microwave, chest freezer, water dispenser, air conditioner, soundbar, TV console, door; TV, nightstand (open the drawers), stool; floor and table lamps (lit, evening mood); dining, office and armchair (tucked too); ottoman, side table, radiator; painting, mirror, oval mirror, air purifier; coffee table, dining table, desk, L-desk, window (light patch on the floor), laptop.
- **Wrong looks like:** parts flickering where they meet; feet, legs or casters sunk or floating; pillows or cushions floating or buried, cushions not taking the locked tint; a resize stretching a dial into an oval or the fan head off its pole; lamp light above or below the shade; a shoe through a shelf or a garment through the rail; the dining table with a slab end instead of four legs; glass in front of a frame or casting a solid shadow.
- **Judge on purpose:** brass reading as dark bronze; slivers of light between the curtain folds; recolour leaving the dining-chair pad and lamp ceramic alone; mirror glass vs grey card; window glass vs blue panel; scatter cushion lean (~50°).
- **Needs:** real GPU.
- **Rides:** `6a7f93f` (#210), `882db71` (#216), `304b9b4` (#218), `7cea640` (#219), `a3f0ff4` (#221), `073a4b4` (#223), `d6fa818` (#225), `a1f1755` (#227), `2477e58` (#228), all B-ismark/Danmu.

### Fix, Try a fix and Re-fit refusal toasts
- **Where:** left rail open (Room check is unmounted when it is shut). Press Fix where it declines; Try a fix on a finding ("No safe way to move those"); resize a wardrobe past the room and press Re-fit ("No safe way to fit that").
- **Wrong looks like:** a long refusal (up to 169 characters) pushing its dismiss button off at ~400 px, or unreadable in 14 s; repeated Fix presses stacking identical toasts; furniture through a wall in the 2D plan after a press; the toast not announced by a screen reader.
- **Needs:** any browser at phone width, plus a screen reader.
- **Rides:** `4cc663b` (B-ismark/Danmu#89)

### A wall that stops says nothing to someone who can see
- **Where:** pull a wall inward until the widest piece stops it — 3D handle, plan handle, plan arrow keys, Inspector's **In 10 cm**. Also rename a piece to a ~45-character unbroken string, narrow the left rail, and refuse a width.
- **Wrong looks like:** the stop reading as a broken button (In 10 cm changes nothing on screen); the long name giving the rail a horizontal scrollbar.
- **Needs:** any browser (a judgement call).
- **Rides:** `270455f` (B-ismark/Danmu#72)

### Split a wall, drag half into a step, drag a wall past its corner
- **Where:** 2D plan: right-click a wall → *Split wall here*, then drag either half in and out; Inspector → **Split in half**, then a join button; push an L's inner wall through its corner. Then 3D: drag a split half by its handle and watch the shell, paint and windows on it. Keyboard: Tab to a split half and press arrows past zero and back.
- **Wrong looks like:** a slanted wall anywhere; a 3D wall rebuilding with a seam, a gap, a flicker or paint jumping walls mid-drag; a window or picture riding the wrong half; the focus ring left on a different wall after a drag or an arrow press; a step dragged back to nothing leaving a dot or a stray label.
- **Needs:** any browser for the plan (checked headlessly: split, step and focus follow, no slant); a real GPU for the 3D shell.
- **Rides:** `d27ca06` (B-ismark/Danmu#330)

### Right-click a wall, the wall behind a TV, a piece, the floor
- **Where:** 3D tab: right-click bare wall (the back walls of the corner view), then the TV, then its *The wall behind it…* row; a sofa (*Keep where it is*); the floor (*Change the floor…*). 2D plan: right-click just outside the wall line behind the TV, then the TV's body; *Add a window here* on a bare wall; *Paint this wall…* with the right rail shut. Phone (375px) and tablet (800px): long-press a wall, then *Paint this wall…*; long-press a sofa that sits against a wall.
- **Wrong looks like:** the room's menu ("Add from the Library… / Reset the view") on a wall; a wall menu on the TV's own body, or a TV menu on the plaster beyond it; the accent frame on a different wall from the one pressed (the 3D press maps the hit point to the outline, so a wrong frame means the mapping is off); a window landing on the neighbouring wall at a corner; a right-press on a plan wall or piece starting a drag, or hover going dead after a menu closes; on a phone or tablet, *Paint this wall…* or *Change the floor…* closing the menu with no Details sheet or tab coming up, or a long-press on a wall-side sofa opening the wall's menu; a right-click on the skirting board opening the room's menu.
- **Needs:** any browser for the plan (checked headlessly: every row above opened the menu it should, *Add a window here* added one piece, no page errors); a real GPU for the 3D press (headless reached the wall menu at one point of the corner view only).
- **Rides:** `8537887` (B-ismark/Danmu#331)

## Shell and flow

*The app's shell, the capture and scan screens, and the phone layout: the things a test can measure but only a person can judge.*

### Rooms page, Settings Back and the footprint page
- **Where:** `/` on a fresh profile, an old `/workspace` bookmark, and a private window with site data blocked. Settings opened offline from a room, from the View gear, with Cmd/Ctrl+, from the scan screen's key link, and from the rooms page. **New room** at 1280×800 and 375px.
- **Wrong looks like:** a welcome page flashes first. The blocked window offers **Create** instead of **Try again**. Back is not beside the heading, says plain "Back", or leaves the app. The footprint page scrolls at 1280×800, or its shapes and buttons don't reflow at 375px.
- **Needs:** any browser, plus a phone for Settings' cards.
- **Rides:** `150e12a` (B-ismark/Danmu#211), `1ea06f1` (B-ismark/Danmu#213)

### Collapsed rail strip icons with a screen reader
- **Where:** with VoiceOver or NVDA on, close the right rail and move through its strip icons.
- **Wrong looks like:** an icon read as "button" with no name.
- **Needs:** a screen reader.
- **Rides:** `5114b5f` (B-ismark/Danmu#179)

### Catalog rows: hover actions, selected row, narrow list
- **Where:** the rail's Catalog, at 1024–1279px (or the list dragged narrow) and at 1280+. Point at rows, click hide on an unselected row, select a row (also in a group), Tab and Shift+Tab through rows. On a phone, the 3D tab's Move / Scale / Rotate.
- **Wrong looks like:** a name cut to a few letters, a grey slab or hard edge over it, or the row jumping. Hide needing two clicks. Remove missing on a selected or focused row, or at 1280+. A broken group line. "M…" on a phone.
- **Needs:** a real mouse, a real phone and a screen reader.
- **Rides:** `c2137c4` (B-ismark/Danmu#157), `960036a` (B-ismark/Danmu#165)

### Laptop panes and floating pills
- **Where:** both tabs at 1024, 1280 and 1440 while the room moves. Light wall colours in 3D. Press plan Zoom +/- repeatedly. macOS "Reduce transparency" on.
- **Wrong looks like:** a square corner, a menu landing below its trigger, greyer text on the rails, no frosting over a moving room, a pill lost against a pale wall, buttons shifting as the zoom % changes, a focus ring clipped in the mode strip.
- **Needs:** a real GPU, a Mac, and a touch screen.
- **Rides:** `c2137c4` (B-ismark/Danmu#157)

### Phone and tablet layout
- **Where:** an iPhone with a notch, portrait and landscape: safe areas, Safari's toolbar collapsing, dragging and flicking the sheet, scrolling a panel to its end, pinch and pan on the plan, tap-to-Add, the More (⋯) menu. Then a tablet in portrait at 768–820px.
- **Wrong looks like:** labels under the home bar or the clock, the toolbar jumping or leaving a gap, the page scrolling or bouncing instead of the sheet, the whole page zooming, the tablet pane squeezing the room below half.
- **Needs:** a real phone (touch) and a real tablet.
- **Rides:** `c2137c4` (B-ismark/Danmu#157)

### Lens tilt is read on capture
- **Where:** Android Chrome and iPhone Safari. Reach capture by pressing through the app, not by typing the URL. Turn on the camera, grant motion, and shoot a wall tipped down.
- **Wrong looks like:** nothing visible. Use devtools: a `deviceorientation` listener must stream `beta` and `gamma`, and `beta` must fall as the phone tips forward.
- **Needs:** a real phone on both engines (the iOS `magnetometer` need is unverified).
- **Rides:** `17f9d62` (B-ismark/Danmu#148)

### Scanned pieces sit where the photo shows them
- **Where:** scan a room with a wardrobe or sofa against a wall, a print or mirror near a corner shared by two photos, a wardrobe/curtain/bookcase running off the frame, a plant/floor lamp/stool cut by the frame side, a dining table with chairs both sides, and an ottoman beside a coffee table with a tray on it. Check 3D, 2D Plan and Room check against the photo; count chair rows.
- **Wrong looks like:** a floor piece's back through the plaster or a hand's width off the wall; a corner piece on the wrong wall; a high wall fixture as a ceiling light; a cut piece as a sliver, growing through a side wall or away from the side the photo saw; a round piece out in the room; fewer chair rows than chairs, an unticked chair naming the wrong twin; an ottoman (or a stool/armchair listed as *Other*) in the air, on the tabletop, or overlapping the table with Room check silent.
- **Needs:** a real scan with photos.
- **Rides:** `17f9d62` (B-ismark/Danmu#148), `e998926` (B-ismark/Danmu#164), `0aa19b2` (B-ismark/Danmu#195), `0fb6a27` (B-ismark/Danmu#180)

### Re-scan after dragging a wall, and restoring your moved pieces
- **Where:** build a room from photos, drag one wall about a metre, then Room → **Re-scan**. On a photographed room, move a piece and add one, Room rail → Re-scan → **Look again** → Continue; then Room check › Layouts → *Before re-scan*.
- **Wrong looks like:** Re-scan doing nothing on a reshaped room, or floor pieces off their walls afterwards; *Before re-scan* not putting the moved and added pieces back; the studio keeping the old arrangement.
- **Needs:** a real scan with photos.
- **Rides:** `91f1f6a` (B-ismark/Danmu#150), `c2137c4` (B-ismark/Danmu#157)

### Does the rebuilt room look like the room
- **Where:** any preset → *Start with photos* → four real photos → detect → **Continue**.
- **Wrong looks like:** pieces on the wrong wall or out of proportion with the real room.
- **Needs:** a real scan with photos, and a person's judgement.
- **Rides:** `e6cd8f4` (B-ismark/Danmu#154)

### Detect review: kept pieces, a bed seen twice, linking by hand
- **Where:** detect screen. Untick rows with their checkbox, then **Continue with N pieces**, and also untick everything. Photograph a bed on two walls: the repeat starts unticked and asks *"Same bed as on Wall 1?"*. On the second wall's tab press the bed row's **link** icon, open *Same as…* and pick Wall 1's bed; check **All walls**, Continue; untick or delete either bed, then tick it again.
- **Wrong looks like:** a left-out piece in the studio, or a kept one missing; + reading as "add new"; two ticked beds, two beds or none, or a bed somewhere neither photo shows; the picker offering a linked piece or the row itself; the walls disagreeing on kept or left out; the caption naming the wrong wall, clipped at 360px, or *"Same the bed"*; an old room opening with pieces missing.
- **Needs:** a real scan with photos, at phone width.
- **Rides:** `fdd1f20` (B-ismark/Danmu#160), `420576e` (B-ismark/Danmu#260), `7c33c43` (B-ismark/Danmu#263)

### The capture flow's cards and buttons
- **Where:** a fresh browser profile: Rooms → any shape → *Start with photos*. Download the finder from the card under the heading, add photos while it runs, Continue. Then on the detect screen: a row with a repeat, a doubted size and a link, at 390px and 1440px. Also *Later* on the card, then Continue (the scan screen asks instead).
- **Wrong looks like:** the card's bar stuck or restarting at zero on the scan screen; the scan screen asking to download again after the card finished; a dialog with no visible step name; a row carrying two notes at once; the link icon, eye and × crowding the name at 360px; the empty checkbox reading as a button with nothing on it.
- **Needs:** any browser, a fresh profile, a real scan with photos, at phone width.
- **Rides:** this branch (`claude/friendly-maxwell-cep4vz`)

### Paper colour and the room size hints
- **Where:** light mode on a real display, with pale wall colours in 3D. Resize a rug past the room in the Inspector. Drag a room's width down to its largest piece.
- **Wrong looks like:** paper reading grey or yellow. The hint saying the rug "needs" the room's width instead of saying it does not fit. The size sentence appearing before the floor is reached.
- **Needs:** a real screen.
- **Rides:** `0c3cd64` (B-ismark/Danmu#158)

### Room size on the shape picker, and the "typical sizes" callout
- **Where:** New room → **Room size · optional**: change shape, type a size, type 80 m. Start without typing: the studio's floating "These are typical sizes" callout with **These are right**, ≈ sizes, and ≈ wall lengths on capture; collapse and scroll the rail, resize; a phone. Reload afterwards.
- **Wrong looks like:** the callout or its bubble crowding the rail at 1024–1279px, too small for a thumb, covering the app bar on a phone, left behind, or back after it was cleared (✕ or a reload right after typing); its arrow off the size fields; a ≈ on a measured room; an unreadable refused rim in the glass rail.
- **Needs:** a real phone, and a person reading the callout.
- **Rides:** `fdd1f20` (B-ismark/Danmu#160), `513f1e5` (B-ismark/Danmu#246), `9ac44bf` (B-ismark/Danmu#252)

### Photo tags stay on the photo
- **Where:** the detect screen with boxes at the photo's right edge and top, and one past the frame. With **Add a piece by hand** on, drag and tap the X.
- **Wrong looks like:** a tag or X past the photo's edge, the review scrolling sideways at 360px, a tag not touching its box, a ceiling light's box not toggling.
- **Needs:** a real phone with a real scan.
- **Rides:** `ac7104a` (B-ismark/Danmu#161)

### Scan photo pinned while the list scrolls
- **Where:** scan screen with a long list, scrolled to the end. On a phone: swipe on the photo strip, turn on **Add a piece by hand**, Shift+Tab up the list.
- **Wrong looks like:** the photo gone or cut off, the last row hidden, the strip jumping as the address bar slides, a tiny inner scroll, or a focused row under the strip.
- **Needs:** a real phone (touch).
- **Rides:** `a5c63b2` (B-ismark/Danmu#162)

### A change survives the phone backgrounding the browser
- **Where:** on a phone, duplicate a piece or type a room width, switch apps or lock the screen at once, then kill and reopen the browser. Also in Safari: type a width and reload at once.
- **Wrong looks like:** the duplicate missing, the width reverted, or a half-saved room (new width, old outline).
- **Needs:** a real phone, plus desktop Safari.
- **Rides:** `31bac6a` (B-ismark/Danmu#163)

### A scanned room built from photos
- **Where:** scan a room with an armchair, dining table, sofa, a pink/patterned piece, a window with curtains; build it; pick each Style theme.
- **Wrong looks like:** the armchair as a two-seat sofa; one sofa listed twice; any photo colour or one aubergine tint; a window proud of the wall; curtains smaller than the window; a theme skipping scanned pieces; the privacy line wrong for where photos went.
- **Needs:** a real scan with photos (on-device model and a key).
- **Rides:** `0e11438` (B-ismark/Danmu#256), `a2ec948` (B-ismark/Danmu#254), `c2137c4` (B-ismark/Danmu#157)

### Cloud scan files rows under photographed walls
- **Where:** a Google key, one wall photographed, then two; reload; *3 pieces left out* card; an old scanned room opened and re-scanned.
- **Wrong looks like:** *couldn't make sense of the reply* on real furniture; a row with no tag on its photo; `__slot:` in any name; a piece moved on open; the left-out card on an on-device scan or after a reload.
- **Needs:** a real scan with photos and a key.
- **Rides:** `bd09f2f` (B-ismark/Danmu#171), `a080c3e` (B-ismark/Danmu#172), `408cdbe` (B-ismark/Danmu#173)

### Scan review rows: rename and size wording
- **Where:** scan review, type a new name on a row (shelf → "Shoe rack", lamp → "Ceiling light", bed → "fri", sofa → "lamp"), with and without a measured room; on a phone, tap an option. *Photograph your real room* with a sofa/bed foot-cut, a stool tipped down, a sofa cut at the side, a door cut at the bottom; rename to Chair/TV and press *Use X?*.
- **Wrong looks like:** no list while the word names a Library piece; one option where a family has two; the row keeping the half-typed word or old model; the tap also toggling the next row or an offer chip; "Floor lamp" → "Tall lamp" offering another lamp; a renamed "Painting" not on the wall; "about"/"at least" missing on the cut axis or on the whole one; both on one line; a bare *2.67 m* with no *wide/tall*; chips wrapping under the tick at 360 px; a flagged correct piece needing more than one tap.
- **Needs:** any browser, a real phone (touch), a real scan with photos.
- **Rides:** `1c7644b` (B-ismark/Danmu#240), `e12c0bb` (B-ismark/Danmu#241), `0fb6a27` (B-ismark/Danmu#180), `12b0209` (B-ismark/Danmu#170)

### Flow screens, Photo and Check your furniture
- **Where:** Rooms (full list) → *Photograph your room* empty then with three photos (hover cards, a card's Wall list, plan walls, Add photos tile) → New room → Photos → Check your furniture → Building, with the waiting card and *Your pieces*; Settings; at laptop, ~1000 px and phone widths.
- **Wrong looks like:** *Continue to photos* not leading from *Photograph your room*; sticky card/index sliding under the bar; buttons below the fold at 1280 × 800; step names or chips off a phone edge; the Building floor as a bounding box or missing ≈; Settings index marking the wrong card; Open buttons misaligned; any sideways scroll; the lit wall off the outline or not the one named (U-Shape: no wall ahead); shimmer missing or wrong card lifted; the Add tile squat or thin; loader stuttering or moving under reduced motion; piece colours/dots indistinguishable; box↔row hover not linking; a picked model left unticked.
- **Needs:** any browser, a real scan with photos, a real phone.
- **Rides:** `2b7e446` (B-ismark/Danmu#243), `5bac78c` (B-ismark/Danmu#242), `e12c0bb` (B-ismark/Danmu#241), `0e11438` (B-ismark/Danmu#256), `a2ec948` (B-ismark/Danmu#254), `9ac44bf` (B-ismark/Danmu#252)

## Look and light

*How the 3D room looks, lights and sounds, and what a scan builds into it.*

### Hide interface in 3D and on a phone
- **Where:** 3D Model tab, click the room, Ctrl/Cmd + \ (also from a rail text field and the View menu row), on a phone and on a German/Nordic keyboard.
- **Wrong looks like:** a cluster left over the room, the camera moving, a reopened Library card losing its search, the pill off-centre or under the home indicator, the key dead on a German/Nordic layout.
- **Needs:** any browser (3D), a real phone, a non-US keyboard.
- **Rides:** `e8b6bd3` (B-ismark/Danmu#314)

### Eyedropper in 3D and on touch
- **Where:** select a piece, click the 3D room, press I, point at the sofa, back wall, floor; on touch, the *Pick* button under a colour grid.
- **Wrong looks like:** a sampled colour that changes with time of day or mood (pixel, not paint), the card lagging or leaving the window, the clicked piece selected or nudged, the docked card over the phone toolbar.
- **Needs:** real GPU, touch.
- **Rides:** `e8b6bd3` (B-ismark/Danmu#314)

### Best looking on a real GPU
- **Where:** any room, 3D Model, View → Quality → Best looking, every mood, flip to Smoother and back; Export → This 3D view. Settings → Best looking; open a room twice, on a real phone and a real laptop GPU.
- **Wrong looks like:** Best looking flatter than Smoother; backdrop a different colour inside the canvas; a windowless room as bright as one with windows; wood grain as stripes; lamp shade clipping white; the PNG missing the shading; the veil lifting onto a dark canvas, or "The 3D view could not draw this room" on a healthy device.
- **Needs:** real GPU, real phone.
- **Rides:** `c2137c4` (B-ismark/Danmu#157), `93e65aa` (B-ismark/Danmu#306)

### The day strip
- **Where:** 3D Model tab, the sun pill: rest, approach, drag 05:00 → 22:00 slow and fast, release off the strip, arrows from 23:30/00:00, Overcast, reduced motion, open the Library, reload at morning/19:30/night; a phone.
- **Wrong looks like:** flicker or stickiness opening/closing; handle trailing the hand; glyph jumping instead of morphing (only sun↔moon at 06:00/19:30); sun not golden; strip moving when the Library opens; room light lagging after release; opening at noon or at the last scrubbed hour; a flash of midday on load; the horizon phrase playing more than once or harshly.
- **Needs:** real GPU, a phone, ears.
- **Rides:** `e4e3f4e` (B-ismark/Danmu#261) (also #178, #176, #246, #250, #252, #254, #256)

### Carrying a piece: sway, base, sounds
- **Where:** 3D Model, carry the sofa slowly, fast, and into the coffee table; drag a piece and a wall on the 2D plan; add, delete, recolour, R, Undo/Redo; View → Sounds off.
- **Wrong looks like:** a carried piece leaning into travel, rocking after half a second, a corner under the floor; grey footprints along its path (also on Smoother); the base not frosted or blocked not light red; a harsh click, a buzz while dragging, two sounds for one press, any sound on open or undo; on a phone, the room sliding up after tapping a piece.
- **Needs:** real GPU, real trackpad, ears, a phone.
- **Rides:** `b955aac` (B-ismark/Danmu#178), `4ccbdc1` (B-ismark/Danmu#176)

### A ceiling light lights from its own disc
- **Where:** T-Shape preset, Best looking, day strip at 22:00; select the ceiling light, slide Brightness to Bright, then back down; repeat on Smoother.
- **Wrong looks like:** the room dark under the fitting with light along wall tops, the fan, curtain rod or windows; the table unlit; Smoother very different from Best looking beyond shadows.
- **Needs:** real GPU.
- **Rides:** `7b4bea8` (B-ismark/Danmu#266)

### Rug placement
- **Where:** a starter living room; Library → Rug into a bedroom and under a dining table, then Fix or Ideas.
- **Wrong looks like:** living — back sofa legs on the rug or coffee table off it; bedroom — rug not starting a third down the bed, nightstands on it; dining — not centred along the table; any rug under a wardrobe/bookcase/fridge, in a door swing, or at an angle.
- **Needs:** any browser.
- **Rides:** `c2137c4` (B-ismark/Danmu#157)

### Loading states, and Fix and Ideas thinking in the background
- **Where:** open a room, switch tabs, run a slow Fix or Try a fix, and run a detection (the loading card); furnished room, rail → Fix/Ideas, orbit while it works; press it then Ctrl+Z; resize a piece until the *That size change left N problems* toast, drag another piece, then press **Re-fit**.
- **Wrong looks like:** the previous room flashing, a veil that never lifts, "Building the 3D view…" on every tab switch, a working toast that outlives its result or shows on a quick Fix, the card not reading dot, "Working…" and Stop on one row; the room freezing while it works; an arrangement landing over your undo; Re-fit overwriting the drag.
- **Needs:** a real GPU, a real laptop and a real phone.
- **Rides:** `6ff707f` (B-ismark/Danmu#159), `0c3cd64` (B-ismark/Danmu#158), `c2137c4` (B-ismark/Danmu#157)

## Screens and polish

*Layout, copy and controls outside the 3D render.*

### Rooms page select mode
- **Where:** `/` with a few rooms, **Select**, pick by tick and by drawing, select-all, scroll, Esc, Delete.
- **Wrong looks like:** the bar scrolling away or a tick passing over it; a ring edge missing; a drawing opening the room in select mode; New room tile still focusable; select-all not showing a dash; ticks hidden on touch.
- **Needs:** Safari or Firefox, touch.
- **Rides:** `e12c0bb` (B-ismark/Danmu#241)

### Removed helper text
- **Where:** rooms empty state, New room, capture, scan review, Settings, Library search placeholder, empty Room check, narrow-window gate, Inspector on a lamp on a table.
- **Wrong looks like:** a consent line, data-loss warning or refusal gone; the placeholder cut off at the narrowest rail; an empty grey line under *On Table*.
- **Needs:** any browser (a copy judgement).
- **Rides:** `e12c0bb` (B-ismark/Danmu#241)

### Empty Rooms page drawing sheet
- **Where:** `/` with no rooms, Light and Dark, laptop and phone; hover the three rows; *Try the starter room*; switch Units to feet.
- **Wrong looks like:** an open/rounded wall corner after the draw-on; labels or scale bar off their lines; the drawing differing from the room it opens; furniture appearing late under reduced motion; title block wrapping on a phone.
- **Needs:** any browser, a real phone.
- **Rides:** `5ef1ed6` (B-ismark/Danmu#300)

### Palette and night mode, whole app
- **Where:** every screen on a real display, especially 3D selection/hover/invalid red, the 2D plan, the home-screen icon, the error page; Settings → Appearance and View settings; Dark/Light/System while flipping the device; studio both tabs, a toast, a refused drag.
- **Wrong looks like:** a leftover terracotta surface; a 3D or plan colour not matching the panel; text not in Figtree; a button label cut off; a cream flash on load or a cream patch in Dark; any warm/brown or olive cast (should be neutral grey); squint-level `--ink-3` captions; the phone status bar staying cream; the 3D room or plan PNG changing with theme; plan amber as a brown slab.
- **Needs:** a real screen, a real phone, Safari.
- **Rides:** `e12c0bb` (B-ismark/Danmu#241), `e4e3f4e` (B-ismark/Danmu#261), `5ef1ed6` (B-ismark/Danmu#300)

### A drawing per piece in the lists
- **Where:** Catalog, Library, Room check → List; at ~1100 px and on a phone.
- **Wrong looks like:** a drawing of the wrong piece; a black or solid drawing; a chip squeezing the name; the selected chip not moss; hidden piece at full ink; photo mark missing.
- **Needs:** any browser.
- **Rides:** `d70b1cc` (B-ismark/Danmu#244)

### Room card counts its furniture
- **Where:** New room → a footprint → Start decorating → back to Rooms; also L, U and an unedited photo room.
- **Wrong looks like:** "0 pieces" on a furnished room; a count unlike the Catalog; furniture outside the drawing's walls; the grid slow with many rooms.
- **Needs:** any browser.
- **Rides:** `513f1e5` (B-ismark/Danmu#246)

### Details panel buttons
- **Where:** 3D studio with nothing selected, a piece, a wall; move one piece; open the Library from the toolbar and the panel; narrowest rail (1024 px).
- **Wrong looks like:** Add not under the empty hint; Start over on an untouched room; Delete/Add not equal halves or Add not the louder; a label truncating at 1280; Add→Close morph clumsy or the toolbar jumping.
- **Needs:** any browser.
- **Rides:** `a2ec948` (B-ismark/Danmu#254), `9ac44bf` (B-ismark/Danmu#252), `d603126` (B-ismark/Danmu#248)

### Paint dabs and the mixer
- **Where:** select a sofa, Colour; rail at 1024 px; mix a colour.
- **Wrong looks like:** a third row; dabs as flat squares; the "+" cell misaligned or not filling; the popover covering the dabs.
- **Needs:** any browser.
- **Rides:** `d603126` (B-ismark/Danmu#248)

### Library and small surfaces
- **Where:** Add → Library rows and hover; Catalog with a window; Change the model; the scan waiting card.
- **Wrong looks like:** a row border, shadow or hover lift; a pill-ended highlight; a solid black window icon; the swap search not empty; Ungroup sharing the swap glyph; a heading or "Still working…" on the waiting card.
- **Needs:** any browser.
- **Rides:** `e4e3f4e` (B-ismark/Danmu#261), `d603126` (B-ismark/Danmu#248)

### Sage for settled, ink for menus
- **Where:** *Room checks out* pill and dot; scan review calm notice; a dropdown with the keyboard.
- **Wrong looks like:** amber where the room is fine; a moss-washed selected option; hover same as selected.
- **Needs:** any browser.
- **Rides:** `d603126` (B-ismark/Danmu#248)

### Corner / Front / Top pill
- **Where:** the view pill bottom-right of the 3D canvas; a phone; orbit by hand.
- **Wrong looks like:** words cut on a laptop; words not icons on a phone; pressed state surviving an orbit or clearing on a floor click.
- **Needs:** trackpad, a phone.
- **Rides:** `9ac44bf` (B-ismark/Danmu#252)

### Hover card, scrollbars, app bar
- **Where:** hover pieces in 3D; hover/tab into Catalog, Library, *Your pieces*, Settings lists; app bar icons; both tabs at 1366/1024/390 px with a long room name.
- **Wrong looks like:** hover card showing more than the name or clipped; a scrollbar at rest or a sideways jump; Safari < 18.2 thick bar; a native title tip; the 2D/3D switch off-centre or under the name.
- **Needs:** Safari, any browser.
- **Rides:** `a2ec948` (B-ismark/Danmu#254)

### How this works dialog
- **Where:** app bar question mark; each topic, scroll, Esc; a phone (bottom sheet).
- **Wrong looks like:** topic list not following or jumping; a key cap breaking; close button under the phone's bar.
- **Needs:** a real phone.
- **Rides:** `a2ec948` (B-ismark/Danmu#254)

### No Light in Style, no default decor
- **Where:** Room rail → Style; a new room; an older room with decor on.
- **Wrong looks like:** a Light heading; a new room with throws and plants; decor not returning from View settings.
- **Needs:** any browser.
- **Rides:** `0e11438` (B-ismark/Danmu#256)

### 3D comes back instantly from 2D
- **Where:** switch 3D → 2D → 3D, moving pieces and pressing keys in the plan.
- **Wrong looks like:** a loading veil; the camera jumping; a plan move missing in 3D; arrow keys also orbiting; the fan spinning while the plan is open.
- **Needs:** real GPU, a phone.
- **Rides:** `0e11438` (B-ismark/Danmu#256)

### Library drag ghost
- **Where:** 3D with the Library open: drag a sofa, stool, table lamp onto a desk, painting to a wall, ceiling fan; Esc, leave and return; Delete right after a drop; repeat on 2D.
- **Wrong looks like:** ghost not where it lands, lagging or flickering, casting light/shadow, left after Esc; the row name riding the cursor in 3D; no drag picture on 2D; Delete after a drop doing nothing; Backspace in search deleting a piece.
- **Needs:** real GPU, mouse.
- **Rides:** `e4e3f4e` (B-ismark/Danmu#261), `61e4324` (B-ismark/Danmu#258)

### Saved pictures and the print plan
- **Where:** Export → This 3D view at midday, 18:30, 22:00 on Best looking and Smoother; on a phone; Export → Floor plan on the largest preset; Floor plan to print opened in a browser, a design tool, printed at 100%.
- **Wrong looks like:** evening/night exports muddy or orange; framing unlike the screen; the live view blank after export; badges off pieces or legend overrun in the SVG; the 1 m bar not 20 mm.
- **Needs:** real GPU, a real phone, a printer.
- **Rides:** `3172cc9` (B-ismark/Danmu#268)

### Mounted pieces stay put when resized
- **Where:** hang a Curtain over a window, type window depth 200 mm, then drag the depth handle, then 60 mm; resize a TV, print, ceiling fan and door.
- **Wrong looks like:** sill through the curtain; curtain moving sideways or another curtain moving; window sinking into plaster; two undos needed; TV/print off the plaster; fan through the ceiling; door threshold off the floor.
- **Needs:** any browser.
- **Rides:** `624a637` (B-ismark/Danmu#317)

## How to check

- Playwright is preinstalled; launch Chromium with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` or there is no WebGL.
- Serve with `pnpm build && pnpm exec next start -p PORT` (`pnpm start -- -p` drops the flag). Kill the server before rebuilding.
- Seed rooms in IndexedDB `keyval-store` / `keyval` under `room:<id>:meta`, `:transforms`, `:touched`; use one fresh context per room.
- The canvas draws on demand: move the mouse over it and wait seconds. ~14 `mouse.wheel(0, 240)` steps frame the whole shell.
- Find 3D parts by `userData.danmuPartId` via a `__THREE_DEVTOOLS__` EventTarget installed with `addInitScript`; select by clicking and reading `aria-selected`; wait on plan pieces with `{ state: 'attached' }`.
- Never compare SwiftShader screenshots by hash; look at them.
- The service worker registers only in a production build (`pnpm build && pnpm start`) on `localhost`; a LAN IP is not a secure context. A worker outlives the server on its port.

