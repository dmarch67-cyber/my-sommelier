// Pure helpers for the critic notes on the Wine page (no I/O, so tests can import them).

export type CriticNote = {
  id: string;
  author: string;
  kind: 'critic' | 'merchant' | 'winery' | 'community';
  score: string | null;
  noted_on: string | null;
  note: string;
  source_url: string;
  source_site: string | null;
};

const ORDER: Record<CriticNote['kind'], number> = {
  critic: 0,
  merchant: 1,
  community: 2,
  winery: 3,
};

/** Critics first, newest first; the winery's own note last. */
export function sortNotes(notes: CriticNote[]): CriticNote[] {
  return [...notes].sort(
    (a, b) =>
      ORDER[a.kind] - ORDER[b.kind] ||
      (b.noted_on ?? '').localeCompare(a.noted_on ?? '') ||
      a.author.localeCompare(b.author),
  );
}

/** "Wine Advocate · 2024 · shop.com" style caption under the author. */
export function noteCaption(n: CriticNote): string {
  const kind =
    n.kind === 'winery' ? "Winery's own note" : n.kind === 'merchant' ? 'Merchant' : null;
  return [kind, n.noted_on?.slice(0, 4) ?? null, n.source_site].filter(Boolean).join(' · ');
}
