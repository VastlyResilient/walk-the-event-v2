# Walk the Event: first-time visitor QA

Date: 2026-10-31. Build: http://localhost:5199/
Method: Playwright driving real Chrome (`--use-angle=metal`, GPU on), headless. Only real input was used: mouse/touch-style drags, mouse wheel, keyboard and clicks on visible elements. No `window.__walk` or other JS internals were used to move around.
Screenshots: `qa/visitor/mobile/NN_*.png` (393x852, DSR 3, touch, saved at CSS scale) and `qa/visitor/desktop/NN_*.png` (1440x900).

Caveat: swipes were sent as mouse down/move/up on a touch-emulated context, as the brief asked. Text selection seen after drags (mobile 55, 89) is probably partly caused by this. A real finger may not select text.

---

## Mobile (393x852)

### Step log
| # | Action | What I saw | Shot |
|---|---|---|---|
| 1 | Load | Title card "Walk the Event", Start walking button, top bar (map, chat, sound, settings), Downstairs/Upstairs pill, and a right rail of dots. It is clear right away. | 01, 02 |
| 2 | Tap Start walking | Hermes appears and says "Next up". A "SWIPE UP TO WALK" hint shows at the bottom, plus a "Hold to walk" button. I understood how to walk within about 5 s. | 03, 04 |
| 3 | Swipe up | I move forward. A pink glowing frame with a "+ Self Portrait" chip appears, and Hermes points at it. One long swipe moves me roughly one chapter. | 05, 07 |
| 4 | Swipe down | I walk backwards. A short swipe does little; a long one works. | 08, 09 |
| 5 | Short swipes up | Back at Come Closer. The station dot on the rail is highlighted. | 10–12 |
| 6 | Tap the pictures in the scene (not the glow) | Nothing happens. You have to hit the glow or the chip. | 13 |
| 7 | Tap the rail's Self Portrait dot | Flies into the station, but the lower half of the screen is **solid black for about 1–3 s**, then the sheet loads. | 14, 15, 16 |
| 8 | Station sheet | 3D photo with "DRAG TO LOOK", title, artist, blurb, wall-card source, fact chips, thumbnails, Ask Hermes, Share, Back to the walk. Text is legible and well set. | 16–20 |
| 9 | Tap a thumbnail | Nothing visible happens (no lightbox). | 21 |
| 10 | Back to the walk | A **pale blue wash covers the whole screen** for a moment, then I return to the same spot (Come Closer). Back works. | 22–24 |
| 11 | Hold to walk | Works and walks forward. | 26, 27 |
| 12 | Walk to Violet Hall | Hermes says "Not in the footage, but I've got photos. Tap the beacon on the left". **I could not see a beacon** where I stopped (31). Stepping back a little showed the Mandala dot highlighted, but there was still no obvious chip in the scene (33, 34). | 30–34 |
| 13 | Map | A clear floor plan with stations (pink) and chapters. "Station: tap to fly in". Tapping Mandala flies straight into the station. | 35–38 |
| 14 | Ask Hermes about this (from Mandala) | The chat opens pre-filled ("Tell me about Mandala") and gives a good answer with a "Take me to Mandala" button. | 39 |
| 15 | Tap the "What's upstairs?" chip in that chat | **The chat closed and no answer appeared.** I was back on the station sheet. My typed off-topic question went nowhere. | 40, 41 |
| 16 | Tap Ask Hermes about this again | **The station closed and I was dropped back in the walk at White Curve.** I did not expect that. | 42–44 |
| 17 | Ask Hermes from the top bar | Works. "What's upstairs?" says there are no stations upstairs and offers a "Take me upstairs" button. An off-topic question ("where is food?") gets a polite deflection. | 45–47 |
| 18 | Walk on to Projection Room | **I overshot The Shape of Everything.** With normal swipes, the chip only shows at an exact spot. A tiny swipe back found it. | 48–53 |
| 19 | Drag the sheet handle down to dismiss | It did not dismiss. Instead **it selected all the sheet text** (blue highlight). | 54, 55 |
| 20 | Browser Back from a station | Went to `/map/` (the map), not back to the walk. Closing the map dropped me on the **title screen** (back at Start walking). I lost my place. | 56, 57 |
| 21 | Start again; drag the rail | The rail can be scrubbed. It jumped me to Deep Blue (Hermes Journey). | 58, 59 |
| 22 | Hermes Journey station, Share | Share threw a page error the first time: `Cannot read properties of undefined (reading '1')`. Nothing visible happened (no toast, no sheet). | 60–63 |
| 23 | Merch glow, Persistence 2 | Both opened by tapping the glow or chip. Persistence was another overshoot that needed a tiny swipe back. | 69–75 |
| 24 | Keep swiping past Into the Dark | It **flows straight upstairs** (The Blue Ascent) and the pill flips to Upstairs. I found upstairs without help. | 76–81 |
| 25 | Upstairs | Beacon Hall, Night Lounge, Long Corridor, Disco Floor, Violet Gallery, Plant Room, Balcony. There are no stations, only commentary. Then the end card "That's the night." | 81–89 |
| 26 | All stations | A carousel (01/06) with Read the card / See it in the walk / Share and arrows. Swipe works. "See it in the walk" opens the station sheet in the walk. | 90–97 |
| 27 | Settings | Guide voice (Hype Host / Curator / Hacker Cool), video quality, motion, gyroscope, captions. It is clear. | 99 |
| 28 | Upstairs pill, then map Upstairs tab | Works. On the upstairs map, the "TOP OF THE S…" label is **clipped off the right edge**. | 100–103 |

**Stations found:** 6 of 6 downstairs (Self Portrait, Mandala, The Shape of Everything, Hermes Journey, The Merch Wall, Persistence 2). I found 4 by walking and 2 only after nudging back, or through the map or rail. **Upstairs:** yes, by walking on, and the pill and map also show it. **Time to understand walking:** about 5 s, thanks to the swipe hint.

**Guide:** Mostly helpful. It names what's ahead and points at the glow. Problems:
- Some lines refer to a "beacon" I could not find.
- Bubbles type out letter by letter, so they are often caught half-written ("Psst. Those portrait screens sa", 05).
- The character stands in the centre of the footage and covers part of it.

---

## Desktop (1440x900)

### Step log
| # | Action | What I saw | Shot |
|---|---|---|---|
| 1 | Load | The same title card. The footage is a portrait strip in the centre with large dark side panels. The pill moves to the top right. | 01 |
| 2 | Click Start, then wheel | The wheel walks forward smoothly. **There is no "scroll to walk" hint on desktop**, but scrolling is the natural first try. | 02–04 |
| 3 | Click the Self Portrait chip | Flies in. The photo fills the left side and an info panel sits on the right. Readable. | 05, 06 |
| 4 | Thumbnail, drag to look | The thumbnail did nothing. Dragging rotates the 3D photo slightly. | 07, 08 |
| 5 | Escape | Leaves the station and returns to the walk at the same place. Good. The fly-out takes about 3–6 s, and for that time the photo shows with no panel. | 09–11 |
| 6 | Arrow keys | ArrowDown/ArrowUp walk ("Rewind! I'll walk backward too"). | 11, 13 |
| 7 | Space / PageDown | Space **re-opened the Self Portrait station** (it activated the focused chip). I had expected it to walk. | 14, 15 |
| 8 | Wheel to Violet Hall | Hermes asks me to "Tap the beacon on the left". **I could not see a beacon**, the same problem as on mobile. Clicking the rail's Mandala dot works. | 19–23 |
| 9 | Map, click a chapter (09 The Gallery) | Flies there. **The URL then stays stuck at `#chapter-gallery`.** | 25, 26 |
| 10 | Ask Hermes (top bar) | The panel docks bottom right. Typed questions and chips work, and "Take me upstairs" takes me to The Blue Ascent. | 27–31 |
| 11 | Wheel through upstairs | **Position jumps around between floors.** From Disco Floor I was thrown back to **downstairs Gallery** about 1.5 s later (35→36). Then Blue Ascent, Beacon Hall again, Long Corridor, **Terminal Row (downstairs)**, then the **title screen**, then Projection Room. | 32–49 |
| 12 | Fresh load (no hash), wheel steadily | Downstairs is fine. Upstairs: Blue Ascent, then Beacon Hall, then **reset to the title screen** with sound muted and progress lost. | 50–69 |
| 13 | Upstairs pill, then idle | Starting from the title state, the pill did nothing (70). After Start, Upstairs, then waiting at The Blue Ascent: fine at 15 s, but at **about 21 s it reset to the title screen**. | 70–81 |
| 14 | Same idle test downstairs | No reset after 24 s. The problem is upstairs only. | 82–84 |
| 15 | Fast wheel through upstairs | Reached The Balcony and the end card. | 85–88 |
| 16 | All stations, ArrowRight, browser Back | The carousel works with arrow keys. **Browser Back returned to the title screen**, not to where I was. | 89–91 |

---

## Prioritized issues

### Blocker
1. **Desktop: the upstairs walk teleports and resets.** While wheeling or idling upstairs, the view jumps to downstairs chapters (Gallery, Terminal Row) or resets to the title screen with sound muted. It reproduced 4 times, including about 21 s of idle at The Blue Ascent. Downstairs idle is fine. (desktop 35→36, 44, 47, 64–69, 77–81)

### Major
2. **Station-launched chat is broken on mobile.** Tapping a chip closes the chat with no answer, and tapping "Ask Hermes about this" again dropped me out of the station into the walk. (mobile 40–44)
3. **Browser Back loses your place.** From a station it goes to `/map/`; closing the map, or Back from All stations, lands on the title screen. (mobile 56–57, desktop 91)
4. **Stations are easy to walk past.** The chip and glow only show near one exact point, and a normal swipe or wheel step skips The Shape of Everything and Persistence 2. A tiny back-step was needed to find them. (mobile 51–53, 73–74)
5. **The guide says "Tap the beacon on the left" in Violet Hall, but I saw no beacon.** (mobile 31–34, desktop 19–21)
6. **Share on a station threw a JS error** (`Cannot read properties of undefined (reading '1')`) and gave no feedback. (mobile 62)

### Minor
7. **Station fly-in shows a black lower half for 1–3 s**, and the fly-in or fly-out takes 3–6 s overall. (mobile 14, desktop 09)
8. **Map chapter click leaves the URL stuck at `#chapter-gallery`**, which may be the cause of #1. (desktop 26)
9. **Dragging selects text and can tint the screen.** Dragging the sheet handle selected all the text instead of dismissing the sheet, and a blue wash appeared on Back. (mobile 22, 55, 89)
10. **Space re-opens the focused station** instead of walking. (desktop 14)
11. **Station thumbnails are not clickable.** (mobile 21, desktop 07)
12. **No scroll hint on desktop**, unlike the swipe hint on mobile. (desktop 02)

### Polish
13. **The upstairs map label "TOP OF THE S…" is clipped off the right edge.** (mobile 103)
14. **Speech bubbles are often caught half-typed, and Hermes covers the centre of the footage.**
15. **Desktop has large empty dark side panels** around the portrait video.
