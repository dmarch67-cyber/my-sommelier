# apps/mobile

The My Sommelier app: React Native + Expo (TypeScript), one codebase for web, Android and later iPhone. Routes use Expo Router and live in `src/app/`.

## What's built (stage 1)

- **Sign-in** with email and password (Supabase Auth).
- **Cellar**: switch LA home / Oregon / Paris / All (remembers the last one), totals for bottles, magnums and on order, search by typing or voice (voice works in Chrome on the web), sort by ready to drink, region or score.
- **Wine page**: label placeholder, place and style, drinking window bar, bottles per cellar with price paid, scores and awards, placeholders for the notes summary and food matches, other vintages in the cellars.
- Tonight, Add and Notes tabs are placeholders for later stages.

## Layout

| Path                      | What                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------- |
| `src/app/`                | Screens (Expo Router). `(tabs)/index.tsx` is Cellar, `wine/[id].tsx` the Wine page.   |
| `src/logic/cellar.ts`     | Pure logic: grouping, totals, search, sort, scores, ripeness. Tested.                 |
| `src/data/CellarData.tsx` | Loads the account's cellar from Supabase once; the one place to swap in offline sync. |
| `src/components/`         | Shared UI.                                                                            |
| `src/lib/`                | Supabase client, sign-in, theme, voice input.                                         |

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
