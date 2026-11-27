import { Rectangle, type BarProps, type BarShapeProps } from 'recharts';

/**
 * Bars for a stacked chart, as one bar each: only the top of the whole bar is rounded, so its parts
 * meet flat, with no notch where one ends and the next begins. The top is the last of `keys`, the
 * order the series stack in, that has something in that bar.
 */
export function stackedBars(keys: string[], { radius = 3, maxBarSize = 22 } = {}) {
  return (series: { name: string }): Partial<BarProps> => ({
    maxBarSize,
    shape: (props: BarShapeProps) => {
      const row = (props.payload ?? {}) as Record<string, unknown>;
      const filled = keys.filter((key) => Number(row[key]) > 0);
      // Nothing in this part of the bar: nothing drawn, not even the pixel below.
      if (!filled.includes(series.name)) return <g />;
      const height = props.height ?? 0;
      // A part above another reaches a pixel down over it, drawn after it: their edges fall
      // mid-pixel, and two half-drawn edges let a hairline of the background show where they meet.
      const overlap = series.name !== filled[0] ? 1 : 0;
      // Corners no taller than the part itself, so a thin top stays a flat cap, not a sliver.
      const corner = Math.min(radius, height / 2);
      return (
        <Rectangle
          {...props}
          height={height + overlap}
          radius={series.name === filled.at(-1) ? [corner, corner, 0, 0] : 0}
        />
      );
    },
  });
}
