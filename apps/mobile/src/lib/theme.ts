/** Look and feel from the approved design brief: white, near-black, one wine red. */
export const colors = {
  background: '#FFFFFF',
  surface: '#F7F5F3',
  border: '#ECE8E4',
  text: '#16131A',
  textMuted: '#6B6570',
  textFaint: '#9C969F',
  accent: '#7A1F3D',
  accentSoft: '#F5E9ED',
  onAccent: '#FFFFFF',
  // Ripeness bar
  young: '#C9B8BF',
  ready: '#7A1F3D',
  past: '#B9A27A',
  danger: '#B3261E',
} as const;

export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export const radius = { sm: 8, md: 14, lg: 20, pill: 999 } as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** Content never gets wider than a phone-ish column, even on a desktop browser. */
export const MAX_CONTENT_WIDTH = 640;
