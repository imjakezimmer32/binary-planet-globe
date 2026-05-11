# Audio (music & sound)

Put your audio files in this folder. They are served from the site root like any other static file.

## How to add a file

1. Copy your track into this folder (e.g. `audio/theme.mp3`).
2. In code or HTML, use a path starting at the site root, e.g. **`/audio/theme.mp3`**.

## Per solar system (galaxy destinations)

In `index.html`, each entry in `GALAXY_DESTINATIONS` can include:

| Field | Meaning |
|--------|--------|
| `audioSrc` | Path under site root, e.g. `'/audio/alpha.mp3'`. Omit or `null` = silence for that star. |
| `audioVolume` | Optional, `0`–`1` (default in code if omitted). |
| `audioLoop` | Optional; default `true` for ambient music. |

Volume is controlled with the **Web Audio API** (`GainNode`), not `HTMLAudioElement.volume`, so **5s fade in/out work on iOS Safari** (which ignores element volume).

## Start screen (“Astra” gate before splash)

- **`outertaming.mp3`** — loops on the **tap / key to continue** screen only.
- Stops as soon as the user continues into the **splash** sequence (same `AudioContext` as solar music).
- Path in code: **`/audio/outertaming.mp3`** (rename the file if you change the name).

## Suggested formats

- **`.mp3`** — widely supported  
- **`.ogg`** — good for web with a fallback  
- **`.wav`** — uncompressed (larger files)

Use only audio you have the rights to ship (your own work, license, etc.).
