import { Text, Tooltip } from '@mantine/core';
import { hourLabel, num } from '../lib/format';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FULL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HOURS = Array.from({ length: 24 }, (_, h) => hourLabel(h));

/**
 * A punch card like GitHub's original one: a dot for every day and hour, sized and tinted by
 * how many things happened there. Hour labels stay horizontal, every three hours. `zone` names the
 * time zone the hours are in, for the tooltips.
 */
export function PunchCard({
  data,
  unit,
  zone,
}: {
  data: { day: number; hour: number; count: number }[];
  unit: [string, string];
  zone: string;
}) {
  const counts = new Map(data.map((p) => [`${p.day}-${p.hour}`, p.count]));
  const max = Math.max(1, ...data.map((p) => p.count));
  return (
    <div className="punch">
      {DAYS.map((day, d) => (
        <div key={day} className="punch-row">
          <Text size="xs" c="dimmed" className="punch-day">
            {day}
          </Text>
          {HOURS.map((hour, h) => {
            const value = counts.get(`${d}-${h}`) ?? 0;
            const ratio = value / max;
            return (
              <Tooltip
                key={hour}
                label={`${FULL_DAYS[d]} at ${hour} ${zone}: ${num(value)} ${value === 1 ? unit[0] : unit[1]}`}
                openDelay={0}
              >
                <span className="punch-cell">
                  <span
                    className={value ? 'punch-dot' : 'punch-dot punch-empty'}
                    style={
                      value
                        ? { width: `${6 + 14 * Math.sqrt(ratio)}px`, opacity: 0.35 + 0.65 * ratio }
                        : undefined
                    }
                  />
                </span>
              </Tooltip>
            );
          })}
        </div>
      ))}
      <div className="punch-row">
        <span />
        {HOURS.map((hour, h) => (
          <Text key={hour} size="xs" c="dimmed" ta="center" className="punch-hour">
            {h % 3 === 0 ? hour : ''}
          </Text>
        ))}
      </div>
    </div>
  );
}
