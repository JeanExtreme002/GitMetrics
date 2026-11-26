import { createTheme, useComputedColorScheme, type MantineColorsTuple } from '@mantine/core';

// Graphite: the interface itself stays neutral, like GitHub, so color is reserved for data.
const brand: MantineColorsTuple = [
  '#f6f8fa',
  '#eaeef2',
  '#d0d7de',
  '#afb8c1',
  '#8c959f',
  '#6e7781',
  '#57606a',
  '#424a53',
  '#32383f',
  '#24292f',
];

// GitHub-like dark neutrals: page #0d1117, surfaces #161b22, borders #30363d.
const dark: MantineColorsTuple = [
  '#c9d1d9',
  '#b1bac4',
  '#8b949e',
  '#6e7681',
  '#30363d',
  '#21262d',
  '#161b22',
  '#0d1117',
  '#090c10',
  '#010409',
];

export const theme = createTheme({
  primaryColor: 'brand',
  primaryShade: { light: 9, dark: 2 },
  autoContrast: true,
  colors: { brand, dark },
  fontFamily: "'Mona Sans Variable', 'Mona Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
  fontFamilyMonospace: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
  headings: { fontWeight: '650' },
  defaultRadius: 'md',
  cursorType: 'pointer',
  components: {
    Paper: { defaultProps: { withBorder: true, radius: 'lg' } },
    Card: { defaultProps: { withBorder: true, radius: 'lg' } },
    Tooltip: { defaultProps: { withArrow: true, openDelay: 200 } },
    Badge: { defaultProps: { variant: 'light', radius: 'sm' } },
  },
});

/** Colors with a meaning, reused by every chart so the app reads as one system. */
export const semantic = {
  stars: 'yellow.6',
  views: 'indigo.4',
  uniques: 'teal.5',
  clones: 'grape.5',
  commits: 'teal.6',
  additions: 'green.6',
  deletions: 'red.6',
  open: 'green.6',
  merged: 'violet.6',
  closed: 'red.6',
  success: 'green.6',
  failure: 'red.6',
  neutral: 'gray.5',
} as const;

/** Low → high intensity scale for heatmaps; low values stay subtle in both color schemes. */
export function useHeatScale(color = 'teal') {
  const scheme = useComputedColorScheme('dark');
  const shades = scheme === 'dark' ? [9, 7, 5, 3] : [2, 4, 6, 8];
  return shades.map((shade) => `var(--mantine-color-${color}-${shade})`);
}

/**
 * A color chosen elsewhere, as a GitHub label's, made visible on this color scheme's background:
 * one too dark on dark, or too light on light, is moved to a gray that reads; others are kept.
 */
export function useVisibleColor() {
  const scheme = useComputedColorScheme('dark');
  return (hex: string) => {
    const value = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
    // Relative luminance, as WCAG defines it.
    const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const luminance = 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
    if (Number.isNaN(luminance)) return `#${value}`;
    if (scheme === 'dark' && luminance < 0.06) return 'var(--mantine-color-gray-6)';
    if (scheme === 'light' && luminance > 0.75) return 'var(--mantine-color-gray-6)';
    return `#${value}`;
  };
}
