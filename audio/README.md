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

Tracks are **preloaded** when the page loads. Playback follows autoplay rules: music starts after the first tap/key on the start screen, and **ramps in** over 5s when you arrive at a system with a track, **ramps out** over 5s when you leave or while in transit. (Constants: `SOLAR_AUDIO_FADE_MS` in `index.html`.)

## Suggested formats

- **`.mp3`** — widely supported  
- **`.ogg`** — good for web with a fallback  
- **`.wav`** — uncompressed (larger files)

Use only audio you have the rights to ship (your own work, license, etc.).
