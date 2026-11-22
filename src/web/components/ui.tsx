import {
  Alert,
  Box,
  Button,
  Center,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconAlertTriangle, IconHourglassHigh, IconRefresh, type Icon } from '@tabler/icons-react';
import { useId, type CSSProperties, type ReactNode } from 'react';

/** Brand red of the logo; the same in light and dark mode. */
export const LOGO_RED = '#E5383B';

/**
 * The GitMetrics mark: a rounded red diamond with a chart cut out of it, rising bars with a
 * trend line above them.
 */
export function Logo({ size = 32 }: { size?: number }) {
  const mask = `logo-${useId()}`;
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" aria-hidden>
      <mask id={mask}>
        <rect x="20" y="20" width="88" height="88" rx="16" transform="rotate(45 64 64)" fill="#fff" />
        <path d="M44 88 V76 M60 88 V68 M76 88 V60" stroke="#000" strokeWidth="9" strokeLinecap="round" />
        <path
          d="M42 60 L58 50 L70 54 L88 38"
          stroke="#000"
          strokeWidth="8"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <circle cx="88" cy="38" r="6.5" fill="#000" />
      </mask>
      <rect width="128" height="128" fill={LOGO_RED} mask={`url(#${mask})`} />
    </svg>
  );
}

/** A quiet number for page headers: icon and value, label underneath, explained in a tooltip. */
export function Counter({
  icon: Icon,
  value,
  label,
  hint,
}: {
  icon: Icon;
  value: ReactNode;
  label: string;
  hint?: string;
}) {
  return (
    <Tooltip label={hint ?? label} disabled={!hint}>
      <Box className="repo-counter" ta="center" style={{ flex: 'none', whiteSpace: 'nowrap' }}>
        <Group gap={6} wrap="nowrap" justify="center">
          <Icon size={17} stroke={1.7} />
          <Text fw={600} size="md" lh={1.1} c="var(--mantine-color-text)" className="tabular">
            {value}
          </Text>
        </Group>
        <Text size="xs" c="dimmed" mt={3}>
          {label}
        </Text>
      </Box>
    </Tooltip>
  );
}

/** "Refresh" keeps its label while it works; only the icon spins. */
export function RefreshButton({ onRefresh, refreshing }: { onRefresh: () => void; refreshing?: boolean }) {
  return (
    <Button
      variant="default"
      leftSection={<IconRefresh size={16} stroke={1.8} className={refreshing ? 'spin' : undefined} />}
      onClick={() => !refreshing && onRefresh()}
      aria-busy={refreshing}
    >
      Refresh
    </Button>
  );
}

/** Title, caption and optional controls for a block that sits directly on the page, without a card. */
export function SectionHeader({
  title,
  caption,
  right,
}: {
  title: string;
  caption?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <Group justify="space-between" align="flex-start" mb="md" gap="sm">
      <Box>
        <Text fw={600}>{title}</Text>
        {caption && (
          <Text size="sm" c="dimmed" mt={2}>
            {caption}
          </Text>
        )}
      </Box>
      {right && (
        <Group gap="xs" wrap="nowrap">
          {right}
        </Group>
      )}
    </Group>
  );
}

/**
 * The counters of a page header. Beside the title they sit on one line; under the description,
 * on narrow screens, they wrap onto more lines instead of running off the screen.
 */
export function Counters({ children }: { children: ReactNode }) {
  return (
    <Group gap="xl" wrap="wrap" style={{ rowGap: 'var(--mantine-spacing-md)' }}>
      {children}
    </Group>
  );
}

export function PageHeader({
  title,
  icon,
  description,
  actions,
  stats,
  onRefresh,
  refreshing,
  statsFrom = 'lg',
}: {
  title: ReactNode;
  icon?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Small numbers shown beside the title on wide screens and under the description otherwise. */
  stats?: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** From which breakpoint the stats sit beside the title; pages with many stats need more room. */
  statsFrom?: 'lg' | 'xl';
}) {
  return (
    <Box mb={36}>
      {/* The title shares its row with the stats and actions; the description gets the full width below. */}
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md">
        <Group gap={10} wrap="nowrap" miw={0}>
          {icon && <span className="page-icon">{icon}</span>}
          <Title order={2} fz={26}>
            {title}
          </Title>
        </Group>
        <Group gap="xs" wrap="nowrap" style={{ flex: 'none' }}>
          {stats && (
            <Box visibleFrom={statsFrom} mr="xl">
              {stats}
            </Box>
          )}
          {actions}
          {onRefresh && <RefreshButton onRefresh={onRefresh} refreshing={refreshing} />}
        </Group>
      </Group>
      {description && (
        <Text c="dimmed" mt={6} maw={760} fz={14}>
          {description}
        </Text>
      )}
      {stats && (
        <Box hiddenFrom={statsFrom} mt="md">
          {stats}
        </Box>
      )}
    </Box>
  );
}

/** One metric inside a StatGrid: a quiet label, a big number and an optional hint. */
export function StatCard({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="stat">
      <Text size="xs" fw={500} c="dimmed" tt="uppercase" className="stat-label">
        {label}
      </Text>
      <Text className="stat-value tabular">{value}</Text>
      {hint && (
        <Text size="xs" c="dimmed" mt={6} lineClamp={2}>
          {hint}
        </Text>
      )}
    </div>
  );
}

/** A single strip of metrics separated by hairlines, instead of a wall of separate cards. */
export function StatGrid({ children, cols = 4 }: { children: ReactNode; cols?: number }) {
  return (
    <div className="stat-strip" style={{ '--cols': cols } as CSSProperties}>
      {children}
    </div>
  );
}

export function ChartCard({
  title,
  description,
  right,
  children,
  h,
}: {
  title: string;
  description?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  h?: number | string;
}) {
  return (
    <Paper p="lg" h={h}>
      <Group justify="space-between" align="flex-start" mb="lg" gap="sm">
        <Box>
          <Text fw={600}>{title}</Text>
          {description && (
            <Text size="sm" c="dimmed" mt={2}>
              {description}
            </Text>
          )}
        </Box>
        {right}
      </Group>
      {children}
    </Paper>
  );
}

export function PageSkeleton() {
  return (
    <Stack gap="md">
      {/* Capped at the screen width, so the loading page never runs off a phone. */}
      <Skeleton h={34} w={260} maw="100%" />
      <Skeleton h={18} w={420} maw="100%" mb="md" />
      <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} h={110} radius="lg" />
        ))}
      </SimpleGrid>
      <Skeleton h={340} radius="lg" />
    </Stack>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Paper p={48}>
      <Stack align="center" gap="xs" ta="center">
        <ThemeIcon variant="light" size={56} radius="xl" color="gray">
          {icon}
        </ThemeIcon>
        <Text fw={600} mt="sm" size="lg">
          {title}
        </Text>
        {description && (
          <Text c="dimmed" maw={460}>
            {description}
          </Text>
        )}
        {action && <Box mt="sm">{action}</Box>}
      </Stack>
    </Paper>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <Alert
      color="red"
      variant="light"
      radius="lg"
      icon={<IconAlertTriangle size={20} />}
      title="Could not load this page"
    >
      <Text size="sm">{message}</Text>
      {onRetry && (
        <Button size="xs" variant="white" color="red" mt="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </Alert>
  );
}

export function PendingState() {
  return (
    <EmptyState
      icon={<IconHourglassHigh size={28} stroke={1.5} />}
      title="GitHub is crunching the numbers"
      description="Statistics for this repository are being computed on GitHub's side. This page refreshes on its own in a few seconds."
      action={<Loader size="sm" type="dots" />}
    />
  );
}

export function FullPageLoader() {
  return (
    <Center h="100vh">
      <Stack align="center" gap="md">
        <Logo size={40} />
        <Loader size="sm" type="dots" />
      </Stack>
    </Center>
  );
}

/** Wraps a query result: shows the skeleton, error or pending states before the page. */
export function QueryView<T>({
  query,
  children,
}: {
  query: { data?: T; error: unknown; isLoading: boolean; refetch: () => unknown };
  children: (data: T) => ReactNode;
}) {
  if (query.isLoading) return <PageSkeleton />;
  if (query.error || !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if ((query.data as { pending?: boolean }).pending) return <PendingState />;
  return <>{children(query.data)}</>;
}

export function NoData({ children = 'Nothing to show yet.' }: { children?: ReactNode }) {
  return (
    <Center h={160}>
      <Text c="dimmed" size="sm">
        {children}
      </Text>
    </Center>
  );
}

/** A small headline number for the page header, with its context in a tooltip. */
export function MiniStat({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: Icon;
}) {
  return (
    <Tooltip label={hint}>
      <Box className="mini-stat" ta="center">
        <Group gap={6} wrap="nowrap" justify="center">
          <Icon size={17} stroke={1.7} className="mini-stat-icon" />
          <Text fz={20} fw={600} lh={1.1} className="tabular">
            {value}
          </Text>
        </Group>
        <Text size="xs" c="dimmed" mt={3}>
          {label}
        </Text>
      </Box>
    </Tooltip>
  );
}
