// OurSpace Design System — Single Source of Truth
// All design values live here. Import from this file everywhere.

// ============================================================
// COLOURS
// ============================================================
export const colors = {
  // Backgrounds
  linen: '#F8F4EE',       // main app background
  parchment: '#EDE8DF',   // card backgrounds
  stone: '#D4CEC4',       // borders and dividers
  warmWhite: '#FAFAF8',   // elevated surface (above cards)

  // Text
  ink: '#1A1A1A',         // primary text — NOT pure black
  warmGrey: '#6B6560',    // secondary text
  faint: '#A8A29E',       // placeholder, disabled

  // Accent 1 — Brass Gold
  brass: '#B8955A',
  brassLight: '#D4A96A',
  brassSubtle: '#F0E4CC',
  brassGlow: 'rgba(184,149,90,0.2)',

  // Accent 2 — Rose
  rose: '#C47B6A',
  roseLight: '#E8A090',
  roseSubtle: '#FDF0EE',

  // Semantic
  success: '#4CAF50',
  successSubtle: '#E8F5E9',
  warning: '#FF9800',
  warningSubtle: '#FFF3E0',
  error: '#C47B6A',
  info: '#2196F3',
  infoSubtle: '#E3F2FD',

  // Neutral
  white: '#FFFFFF',
  black: '#000000',
} as const;

// ============================================================
// CATEGORY SYSTEM
// ============================================================
export interface CategoryDef {
  label: string;
  emoji: string;
  color: string;
  light: string;
}

export const BUILT_IN_CATEGORIES: Record<string, CategoryDef> = {
  groceries:     { label: 'Groceries',     emoji: '🛒', color: '#4CAF50', light: '#E8F5E9' },
  dining:        { label: 'Dining Out',    emoji: '🍽️', color: '#FF9800', light: '#FFF3E0' },
  transport:     { label: 'Transport',     emoji: '⛽', color: '#2196F3', light: '#E3F2FD' },
  health:        { label: 'Health',        emoji: '💊', color: '#E91E63', light: '#FCE4EC' },
  entertainment: { label: 'Entertainment', emoji: '🎬', color: '#9C27B0', light: '#F3E5F5' },
  utilities:     { label: 'Bills',         emoji: '💡', color: '#607D8B', light: '#ECEFF1' },
  shopping:      { label: 'Shopping',      emoji: '🛍️', color: '#FF5722', light: '#FBE9E7' },
  personal_care: { label: 'Personal Care', emoji: '💆', color: '#00BCD4', light: '#E0F7FA' },
  coffee:        { label: 'Coffee',        emoji: '☕', color: '#795548', light: '#EFEBE9' },
  household:     { label: 'Household',     emoji: '🏠', color: '#8BC34A', light: '#F1F8E9' },
  baby:          { label: 'Baby',          emoji: '👶', color: '#FF80AB', light: '#FCE4EC' },
  pet:           { label: 'Pet',           emoji: '🐾', color: '#A5D6A7', light: '#E8F5E9' },
  work_expense:  { label: 'Work',          emoji: '💼', color: '#5C6BC0', light: '#E8EAF6' },
  other:         { label: 'Other',         emoji: '📦', color: '#9E9E9E', light: '#F5F5F5' },
};

export const getCategoryDef = (
  cat: string,
  customCategories?: Array<{ id: string; name: string; emoji: string; color: string }>
): CategoryDef => {
  if (BUILT_IN_CATEGORIES[cat]) return BUILT_IN_CATEGORIES[cat];
  const custom = customCategories?.find(c => c.id === cat);
  if (custom) return { label: custom.name, emoji: custom.emoji, color: custom.color, light: custom.color + '22' };
  return BUILT_IN_CATEGORIES.other;
};

// ============================================================
// TYPOGRAPHY
// ============================================================
export const typography = {
  display: "'Fraunces', Georgia, serif",
  body: "'Outfit', system-ui, sans-serif",

  h1: { fontSize: 'clamp(36px, 10vw, 52px)', fontWeight: 300, letterSpacing: '-2.5px', lineHeight: 1.05 },
  h2: { fontSize: '32px', fontWeight: 300, letterSpacing: '-1.5px', lineHeight: 1.1 },
  h3: { fontSize: '24px', fontWeight: 300, letterSpacing: '-1px', lineHeight: 1.2 },
  h4: { fontSize: '20px', fontWeight: 300, letterSpacing: '-0.5px' },
  lead: { fontSize: '18px', fontStyle: 'italic' },
  bodyText: { fontSize: '15px', lineHeight: 1.6 },
  small: { fontSize: '13px', lineHeight: 1.5 },
  caption: { fontSize: '11px', letterSpacing: '0.3px' },
  label: { fontSize: '10px', letterSpacing: '2.5px', textTransform: 'uppercase' as const },

  numXL: { fontSize: 'clamp(48px, 14vw, 72px)', fontWeight: 300, letterSpacing: '-4px' },
  numLG: { fontSize: '36px', fontWeight: 300, letterSpacing: '-2px' },
  numMD: { fontSize: '28px', fontWeight: 300, letterSpacing: '-1.5px' },
  numSM: { fontSize: '20px', fontWeight: 300, letterSpacing: '-1px' },
} as const;

// ============================================================
// SPACING (8px base grid)
// ============================================================
export const spacing = {
  xs: '4px',
  sm: '8px',
  md: '16px',
  lg: '24px',
  xl: '32px',
  xxl: '48px',
  pagePadding: '20px',
  cardPadding: '20px',
  sectionGap: '12px',
  screenTop: '52px',
  navHeight: '80px',
} as const;

// ============================================================
// CARD STYLES
// ============================================================
export const card = {
  default: {
    background: colors.parchment,
    border: `1px solid ${colors.stone}`,
    borderRadius: '22px',
    padding: spacing.cardPadding,
    boxShadow: '0 2px 8px rgba(26,26,26,0.05)',
  },
  elevated: {
    background: colors.white,
    border: `1px solid ${colors.stone}`,
    borderRadius: '22px',
    padding: spacing.cardPadding,
    boxShadow: '0 4px 20px rgba(26,26,26,0.08)',
  },
  hero: {
    background: colors.ink,
    borderRadius: '28px',
    padding: spacing.cardPadding,
  },
  subtle: {
    background: colors.linen,
    border: `1px solid ${colors.stone}`,
    borderRadius: '16px',
    padding: '12px 16px',
  },
  accent: {
    background: colors.brassSubtle,
    border: 'rgba(184,149,90,0.3)',
    borderRadius: '16px',
    padding: '14px 16px',
  },
  alert: {
    background: colors.roseSubtle,
    border: `1px solid rgba(196,123,106,0.3)`,
    borderLeft: `3px solid ${colors.rose}`,
    borderRadius: '16px',
    padding: '16px',
  },
} as const;

// ============================================================
// ANIMATION PRESETS (used throughout app)
// ============================================================
export const spring = {
  default: { type: 'spring' as const, stiffness: 280, damping: 22 },
  bouncy:  { type: 'spring' as const, stiffness: 400, damping: 20 },
  gentle:  { type: 'spring' as const, stiffness: 180, damping: 24 },
  snappy:  { type: 'spring' as const, stiffness: 500, damping: 28 },
};

export const easing = {
  out:    [0.16, 1, 0.3, 1] as [number, number, number, number],
  inOut:  [0.42, 0, 0.58, 1] as [number, number, number, number],
};

export const reveal = {
  initial: { opacity: 0, y: 24, filter: 'blur(6px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  transition: { duration: 0.65, ease: easing.out },
};

// ============================================================
// COLOUR USAGE RULES
// ============================================================
// 1. NEVER white text on linen background — use ink (#1A1A1A)
// 2. NEVER put brass on white — use on linen or parchment
// 3. Rose is for alerts/warnings, NOT decoration
// 4. Brass is the primary brand colour — use sparingly for emphasis
// 5. Section labels ALWAYS: label style + brass colour
// 6. Amounts/numbers ALWAYS: Fraunces font family
// 7. Body text: Outfit only
// 8. Headings/display text: Fraunces only
