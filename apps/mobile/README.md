# apps/mobile

The My Sommelier app: React Native + Expo (TypeScript), one codebase for web, Android and later iPhone. Routes use Expo Router and live in `src/app/`.

## What's built

Stage 1 (reading):

- **Sign-in** with email and password (Supabase Auth).
- **Cellar**: switch LA home / Oregon / Paris / All (remembers the last one), totals for bottles, magnums and on order, search by typing or voice (voice works in Chrome on the web), sort by ready to drink, region or score.
- **Wine page**: label placeholder, place and style, drinking window bar, bottles per cellar with price paid, scores and awards, placeholders for the notes summary and food matches, other vintages in the cellars.

Stage 2 (writing; every change can be undone):

- **Drink one** (Wine page): takes a bottle out at once; asks which cellar or size only when there's a real choice. Then an optional note: stars and a line (typed or spoken), "Add more detail" for maturity, food, occasion, buy again. Undo puts the bottle back.
- **Order arrived** (Wine page): moves on-order bottles into the cellar.
- **Add bottles** (Add tab, or from a Wine page): type or say "six bottles of 2019 Ridge Monte Bello to Paris"; it fills the count, year, size, cellar and finds the wine, or adds a new one. On-order switch.
- **Delivery upload**: Excel (.xlsx) or CSV. Finds the heading row, matches each line to a wine you have or marks it new, lets you untick lines, then adds everything in one go. It only adds; Undo reverses the whole delivery.
- **Notes** tab lists your tasting notes.

Writes use `src/data/writes.ts`. Bottle counts only change through inventory events; adding goes through the `add_bottles` database function (all lines or none), and Undo through `undo_inventory_events` (adds the opposite events, safe to call twice). See `supabase/migrations/20261124000100_app_writes.sql`.

Tonight is still a placeholder.

## Layout

| Path                      | What                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `src/app/`                | Screens (Expo Router). `(tabs)/index.tsx` is Cellar, `wine/[id].tsx` the Wine page.                                      |
| `src/logic/`              | Pure logic, tested: cellar grouping, search, sort, ripeness; drink choices, wine matching, spoken adds; delivery sheets. |
| `src/data/CellarData.tsx` | Loads the account's cellar from Supabase once; the one place to swap in offline sync.                                    |
| `src/components/`         | Shared UI.                                                                                                               |
| `src/lib/`                | Supabase client, sign-in, theme, voice input.                                                                            |

## Commands

```sh
npm run web -w apps/mobile        # dev server in the browser
npm run typecheck -w apps/mobile
npm test -w apps/mobile           # logic tests (Node's test runner)
npm run build:web -w apps/mobile  # static web build in apps/mobile/dist
```

## Supabase

The app uses the project URL and the **publishable** key in `src/lib/config.ts`. That key is meant to be public: it can only do what row-level security allows, and every table refuses anonymous visitors. Never put the secret (service role) key in the app.

## Web preview

`vercel.json` at the repo root builds the web app on Vercel. Once the repo is connected to Vercel, every pull request gets its own preview link and `main` gets the live link.
