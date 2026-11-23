# My Sommelier

A personal wine cellar app: inventory across several cellars, critic scores, tasting notes, and advice on what to drink by maturity, food, palate and preference.

v1 is for one user with three cellars (Los Angeles, Oregon, Paris). The design allows many users, each with their own account and cellars.

## Stack

- **App:** React Native + Expo (TypeScript). Android first, then web, then iPhone from the same code.
- **Backend:** Supabase: Postgres, sign-in, and row-level security so each account sees only its own data.
- **Offline:** PowerSync keeps an on-device SQLite copy in sync with Postgres.

## Layout

| Path              | What                                                                 |
| ----------------- | -------------------------------------------------------------------- |
| `apps/mobile`     | The Expo app (Phase 2)                                               |
| `packages/shared` | Types and helpers shared by the app and tools                        |
| `tools/import`    | One-time spreadsheet importer (Phase 1)                              |
| `supabase/`       | Database migrations, tests and local config                          |
| `docs/`           | Design notes. Start with [`docs/data-model.md`](docs/data-model.md). |
| `scripts/`        | Developer scripts                                                    |

## Database tests

Needs Postgres 15+ server binaries (`initdb`, `pg_ctl`) and `psql`.

```sh
npm run db:test
```

This starts a throwaway Postgres, applies every migration, and runs `supabase/tests/schema_test.sql`: cellars, magnums, EUR prices, on-order bottles, "94+" scores, the bottle history, and a check that a second user can't read or change the first user's data. CI runs the same script on every pull request.

With the Supabase CLI and Docker you can also run `supabase start`, which applies the same migrations to a full local Supabase.

## Data

Cellar data never goes in this repo. `.gitignore` blocks spreadsheets and CSV files.
