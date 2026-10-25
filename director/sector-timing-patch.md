# Local sector-timing patch (Race Control Desktop 0.1.17)

Vendored locally for F1-Director. Do not commit/push unless Ryan asks.
No upstream PR against Xixixiao2007/F1-RaceControl-Desktop.

## JSON shape on /api/state

### cars[]

Verified against live `/api/full` TimingData / TimingStats (2026-10-22 Asia/Shanghai):

- `lastLap`: string, e.g. `"1:37.840"`
- `bestLap`: string personal-best lap, e.g. `"1:35.127"`. From `TimingData.Lines[n].BestLapTime.Value` (the subscribed stream). `TimingStats.Lines[n].PersonalBestLapTime.Value` still wins when that stream is present.
- `sectors`: array of 3 objects:
  - `value`: sector time string (empty if not yet set), e.g. `"28.631"`
  - `personalBest` / `overallBest`: booleans from PersonalFastest / OverallFastest or Status 2049 / 2051
  - `status`: raw F1 Status (2048 yellow / 2049 green / 2051 purple; often ages to `0`)
  - `segments`: `[{ "status": 2048 }, …]` mini-sectors inside this sector (typically 6–10). From `TimingData.Lines[n].Sectors[*].Segments` (array snapshot or `"0"/"1"/…` object deltas).
- `bestSectors`: length-3 string array from `TimingStats.Lines[n].BestSectors[*].Value` (stable personal-best times for green when live Status ages to 0)
- `speeds`: `{ "i1", "i2", "fl", "st" }` km/h strings from `TimingData.Lines[n].Speeds.I1/I2/FL/ST.Value`
- `pitOut` / `stopped` / `knockedOut`: booleans; `numberOfLaps`: int (TimingData; KnockedOut usually quali-only)

### weather

- Existing: `air`, `track`, `text`
- Added: `humidity`, `wind` (WindSpeed), `windDirection`, `rainfall`, `rain` (boolean), `pressure`

## Build (no Python required)

JDK used: `C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot` (winget Microsoft.OpenJDK.17)

Manual compile matching `tools/build.py`:

```
javac -encoding UTF-8 -source 1.8 -target 1.8 -nowarn -d build/classes @build/javac.args
jar cfm build/F1-RaceControl-Desktop.jar build/MANIFEST.MF -C build/classes .
```

Copied to `F1-Director\share\F1-RaceControl-Desktop-0.1.15_modify.jar`
Backup of prior jar: `share\F1-RaceControl-Desktop.jar.bak-0.1.16`

## Director UI

`director/web-override/app.js` + `style.css` (synced to `share/web`):

- `.sec-purple` / `.sec-green` / `.sec-yellow` on S1–S3 cells
- optional `+0.123` delta vs field / overall best
- when live status is 0: purple via field-min time; green via match to `bestSectors`
- compact `.sec-mini` strip under each sector time (status-colored bits)
- weather board prefers structured `humidity` / `wind` / `rain` (falls back to parsing `text`)
- speeds exposed in `/api/state` only for now (no FL column — keep sectors board dense)

## Upstream clone (local only)

`D:\Develop\F1-RaceControl-Desktop` on branch main, local edits only (not pushed).
