# My Sommelier design brief (v1, approved by Dan 2026-11-23)

Live doc (Claude Doc): https://claude.ai/artifact/RbDbd12rQr8gFkXb23f66G
Screens: https://claude.ai/artifact/DJYE2Me5vauxfs1TRZ8CdE

## Purpose

Help Dan pick the right bottle tonight from whichever cellar he's in, and keep inventory right with little effort. Logging drinks is optional.

## Screens (bottom tabs: Tonight, Cellar, Add, Notes)

1. Tonight (home): ask bar (type or speak). Type filters Red, White, Rosé, Sparkling. Body filters Light, Medium, Full-bodied. No sweet/fortified (not in Dan's cellar). Results = drinking best now, with label, score, count, ripeness bar.
2. Cellar: switch LA / Oregon / Paris / All (defaults to last used). Totals for bottles, magnums, on order. Search (typed or spoken). Sort by ready to drink, region, score.
3. Wine page: label picture, region/grape/style, drinking window with marker, scores by source, summary of third-party notes, food matches, bottles per cellar. Buttons Add bottles, Drink one.
4. Drink one: removes a bottle at once with Undo; optional stars + one line (typed or spoken), expandable to full note.
5. Add bottles: snap label, say it, type it, upload spreadsheet; on-order switch.

## Look and feel

Contemporary, clean, modern. White, near-black text, one accent deep wine red #7A1F3D. Inter type, rounded cards, large tap targets.

## Decisions

- Spreadsheet upload adds a delivery after preview and confirm; never replaces. App is master.
- Label pictures from Vinous/CellarTracker, else Dan's photo, else placeholder.
- Critic notes summarized in 2-3 sentences with link to full notes.
- Wine type/body not in spreadsheet; filled by enrichment. Until then, Tonight filters use name/region guesses.
- Voice input wherever there is typing.

## Data sources behind recommendations (not shown in the app)

Third-party notes are inputs the app reads and analyzes; source names are not part of the design.

- CellarTracker (Dan's account): community notes and scores.
- Vinous (Dan's account): critic scores, drinking windows, notes.
- WineBerserkers forum: recent drinking notes. Weight notes from the last ~2 years most heavily.
- Reddit r/wine: optional, lower weight.
- Vivino: skip (too noisy).
- Possible later subscriptions: Jancis Robinson, Burghound, Wine Advocate.
- Open item: check terms of use for forum sources (WineBerserkers, Reddit) before pulling from them.

## Build order

1. Cellar + Wine page on loaded data (web first, then Android).
2. Drink one + Add bottles (typing, then voice, then label photo, then spreadsheet).
3. Tonight, once type/body/windows are enriched.

Out of first build: other users, sharing, buying, bin locations.
