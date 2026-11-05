---
name: venue-guide
description: Send people straight to a spot in "Walk the Event", the walkable recap of NousCon NYC 2026. Use when someone asks to see, revisit or learn about a NousCon station (the gilded portrait screens, the wall of TVs, the projection, the Hermes Journey space screen, the merch wall, the air-gapped computers), a part of the venue (upstairs, the disco floor, the balcony), or asks "what was at NousCon?".
---

# Venue guide: deep links into Walk the Event

Walk the Event is a scroll-through of the real NousCon NYC 2026 footage with a Hermes guide character. Every
station, chapter and floor has a deep link. Your job: map the request to the right link, add one grounded sentence,
and hand it over.

**Base URL:** `https://vastlyresilient.github.io/walk-the-event-v2/` (the deployed site, e.g. `https://<host>/walk-the-event-v2/`). Append the hash below.

## Stations (downstairs)
| link | station | people may call it |
|---|---|---|
| `#station-led-camera-screens` | Self Portrait by Joshua Wolk | gilded frames, portrait screens, "the mirror thing", camera screens, Joshua Wolk |
| `#station-tvs` | Mandala by Kevin Esherick | wall of TVs, six screens, mandala, sandbox art, Kevin Esherick |
| `#station-projector-screens` | The Shape of Everything by Jteve Sobs | projection, glyph wall, projector, Jteve Sobs |
| `#station-space-screen` | Hermes Journey by Nous Research | space screen, solar system, Hermes Journey, touch screen, orbits |
| `#station-merch` | The Merch Wall | merch, shirts, tees, swag, NOUSCON banner |
| `#station-cpu-terminals` | Persistence 2 by Morry Kolman | computers, terminals, air-gapped computers, Persistence 2, Morry Kolman, "the robot computers" |

## Floors and views
| link | goes to |
|---|---|
| `#floor-down` | Start of the downstairs walk |
| `#floor-up` | Upstairs (the blue staircase, corridor, disco floor, balcony; no stations) |
| `map/` (path, not hash) | The illustrated floor plan; tap any pin |
| `stations/#<station-id>` | The station gallery, opened on that station |

## Chapters
| link | chapter |
|---|---|
| `#chapter-magenta-mile` | Downstairs · The Magenta Mile |
| `#chapter-come-closer` | Downstairs · Come Closer |
| `#chapter-nouscon-corridor` | Downstairs · NOUSCON Corridor |
| `#chapter-the-curve` | Downstairs · The White Curve |
| `#chapter-violet-hall` | Downstairs · Violet Hall |
| `#chapter-projection-room` | Downstairs · Projection Room |
| `#chapter-deep-blue` | Downstairs · Deep Blue |
| `#chapter-atrium` | Downstairs · The Atrium |
| `#chapter-gallery` | Downstairs · The Gallery |
| `#chapter-terminal-row` | Downstairs · Terminal Row |
| `#chapter-into-the-dark` | Downstairs · Into the Dark |
| `#chapter-blue-ascent` | Upstairs · The Blue Ascent |
| `#chapter-beacon-hall` | Upstairs · Beacon Hall |
| `#chapter-night-lounge` | Upstairs · Night Lounge |
| `#chapter-long-corridor` | Upstairs · The Long Corridor |
| `#chapter-disco-floor` | Upstairs · Disco Floor |
| `#chapter-violet-gallery` | Upstairs · Violet Gallery |
| `#chapter-plant-room` | Upstairs · The Plant Room |
| `#chapter-the-balcony` | Upstairs · The Balcony |

## How to answer
1. Pick the single best link. If the request is vague ("show me NousCon"), use the base URL; for "everything", use `stations/`.
2. Say one sentence, using only facts from `data/stations.json` (artist, title, the card text). Never invent details.
3. Give the link on its own line.

Examples
- "take me to the robot demo" / "the computers that talk without wifi" → Persistence 2: `https://vastlyresilient.github.io/walk-the-event-v2/#station-cpu-terminals`
- "the thing that turned me into a painting" → Self Portrait by Joshua Wolk: `https://vastlyresilient.github.io/walk-the-event-v2/#station-led-camera-screens`
- "where was the merch?" → `https://vastlyresilient.github.io/walk-the-event-v2/#station-merch`
- "what was upstairs?" → `https://vastlyresilient.github.io/walk-the-event-v2/#floor-up`
- "the solar system screen" → Hermes Journey: `https://vastlyresilient.github.io/walk-the-event-v2/#station-space-screen`

The page opens the walk, glides to the moment, plays the camera move and opens the station card. Links work on
mobile and desktop; the station card has its own share button that produces the same links.
