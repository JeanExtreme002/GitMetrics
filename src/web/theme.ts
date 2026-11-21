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
