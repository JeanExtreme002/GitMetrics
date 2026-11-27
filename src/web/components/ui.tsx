import {
  ActionIcon,
  Anchor,
  Box,
  Button,
  Center,
  Code,
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
  type AnchorProps,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconCloudOff,
  IconHourglassHigh,
  IconLinkOff,
  IconLock,
  IconLogin2,
  IconMoodEmpty,
  IconPlugConnectedX,
  IconRefresh,
  type Icon,
} from '@tabler/icons-react';
import { useId, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { LOGIN } from '../lib/accounts';
import { ApiError } from '../lib/api';

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

/**
 * "Refresh" keeps its label while it works; only the icon spins. On phones it is the icon alone,
 * so the page title beside it keeps its line.
 */
export function RefreshButton({ onRefresh, refreshing }: { onRefresh: () => void; refreshing?: boolean }) {
  const icon = <IconRefresh size={16} stroke={1.8} className={refreshing ? 'spin' : undefined} />;
  const refresh = () => !refreshing && onRefresh();
  return (
    <>
      <Button variant="default" leftSection={icon} onClick={refresh} aria-busy={refreshing} visibleFrom="sm">
        Refresh
      </Button>
      <Tooltip label="Refresh">
        <ActionIcon
          variant="default"
          size={36}
          onClick={refresh}
          aria-busy={refreshing}
          aria-label="Refresh"
          hiddenFrom="sm"
        >
          {icon}
        </ActionIcon>
      </Tooltip>
    </>
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

/**
 * A person's name or row, leading to their page in GitMetrics. An account with no page here (an app
 * like dependabot[bot], or a commit author GitHub doesn't know) opens on GitHub instead.
 */
export function PersonAnchor({
  login,
  url,
  children,
  ...props
}: AnchorProps & { login: string; url?: string; children: ReactNode; title?: string }) {
  return LOGIN.test(login) ? (
    <Anchor component={Link} to={`/a/${login}`} {...props}>
      {children}
    </Anchor>
  ) : (
    <Anchor href={url ?? `https://github.com/${login}`} target="_blank" rel="noreferrer" {...props}>
      {children}
    </Anchor>
  );
}

/** What went wrong, told plainly, with what to do about it. */
interface Failure {
  icon: Icon;
  title: string;
  description: ReactNode;
  /** GitHub's or the server's own words, when they add to the description. */
  detail?: string;
  /** Another way out than trying again. */
  link?: { label: string; to: string };
  /** Whether trying again can help. */
  retry: boolean;
}

/** Sorts a failed request by its cause, as far as its status and message tell. */
function failure(error: unknown): Failure {
  const message = error instanceof Error ? error.message : '';
  // fetch failing outright: nothing answered at all, so GitMetrics itself isn't running.
  if (!(error instanceof ApiError)) {
    return error instanceof TypeError
      ? {
          icon: IconPlugConnectedX,
          title: "GitMetrics isn't running",
          description: (
            <>
              This page couldn&apos;t reach GitMetrics on your computer. Start it again in a terminal with{' '}
              <Code>npx @gitmetrics/app</Code>, then try again.
            </>
          ),
          retry: true,
        }
      : {
          icon: IconAlertTriangle,
          title: "This page couldn't load",
          description: 'Something unexpected went wrong. Trying again often works.',
          detail: message || undefined,
          retry: true,
        };
  }
  switch (true) {
    case error.status === 401:
      return {
        icon: IconLogin2,
        title: "You're signed out of GitHub",
        description: 'Your GitHub session ended or its access was taken back. Sign in again to keep going.',
        link: { label: 'Sign in', to: '/login' },
        retry: false,
      };
    case error.status === 429:
      return {
        icon: IconHourglassHigh,
        title: "GitHub's hourly limit is used up",
        description:
          'GitHub allows a fixed number of requests an hour, and they ran out. They come back on their own: try again in a few minutes.',
        link: { label: 'See API usage', to: '/settings' },
        retry: true,
      };
    case error.status === 403:
      return {
        icon: IconLock,
        title: "GitHub didn't allow this",
        description:
          "Your access doesn't reach it: it may be private, or its organization may restrict what apps can read.",
        detail: message,
        retry: false,
      };
    case error.status === 404:
      return {
        icon: IconMoodEmpty,
        title: 'Nothing here',
        // The server's own words when they name what's missing; a bare "Not found" adds nothing.
        description: `${/^not found\.?$/i.test(message) ? '' : `${message.replace(/\.?$/, '.')} `}It may have been renamed or deleted, or be out of your access.`,
        retry: false,
      };
    case error.status === 400:
      return {
        icon: IconLinkOff,
        title: "This address isn't right",
        description: `${message.replace(/\.?$/, '.')} Check the link, or start again from the sidebar.`,
        retry: false,
      };
    case error.status === 502 || error.status === 503 || error.status === 504:
      return {
        icon: IconCloudOff,
        title: 'GitHub is having trouble',
        description: "GitHub didn't answer in time. That's usually brief: try again in a moment.",
        detail: message,
        retry: true,
      };
    case error.status === 500:
      return {
        icon: IconAlertTriangle,
        title: 'GitMetrics ran into a problem',
        description:
          'Its server on your computer hit an error. Trying again often works; if it keeps happening, the terminal running GitMetrics says what went wrong.',
        retry: true,
      };
    default:
      return {
        icon: IconAlertTriangle,
        title: "This page couldn't load",
        description: 'GitHub answered with an error. Trying again often works.',
        detail: message,
        retry: true,
      };
  }
}

/** A request that failed: what happened, in plain words, and a way on. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => unknown }) {
  const { icon: FailureIcon, title, description, detail, link, retry } = failure(error);
  const [retrying, setRetrying] = useState(false);
  const again = async () => {
    setRetrying(true);
    try {
      await onRetry?.();
    } finally {
      setRetrying(false);
    }
  };
  return (
    <Paper p={48} role="alert">
      <Stack align="center" gap="xs" ta="center">
        <ThemeIcon variant="light" size={56} radius="xl" color="gray">
          <FailureIcon size={28} stroke={1.5} />
        </ThemeIcon>
        <Text fw={600} mt="sm" size="lg">
          {title}
        </Text>
        <Text c="dimmed" maw={480}>
          {description}
        </Text>
        {detail && (
          <Text size="xs" c="dimmed" maw={480} className="error-detail">
            {detail}
          </Text>
        )}
        {((retry && onRetry) || link) && (
          <Group gap="xs" mt="sm" justify="center">
            {retry && onRetry && (
              <Button
                variant="default"
                leftSection={<IconRefresh size={16} />}
                loading={retrying}
                onClick={again}
              >
                Try again
              </Button>
            )}
            {link && (
              <Button
                component={Link}
                to={link.to}
                variant={retry && onRetry ? 'subtle' : 'default'}
                color="gray"
              >
                {link.label}
              </Button>
            )}
          </Group>
        )}
      </Stack>
    </Paper>
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

/**
 * A small toast at the bottom of the screen: a fill runs across it while it shows, and when the
 * fill ends the toast goes. Give it a new `id` to show it again, the fill starting over.
 */
export function Toast({ id, icon, children }: { id: number; icon?: ReactNode; children: ReactNode }) {
  const [gone, setGone] = useState<number | null>(null);
  const [leaving, setLeaving] = useState<number | null>(null);
  if (!id || gone === id) return null;
  return createPortal(
    <div
      key={id}
      role="status"
      className={leaving === id ? 'toast-pill leaving' : 'toast-pill'}
      onAnimationEnd={(e) => {
        if (e.animationName === 'toast-out') setGone(id);
      }}
    >
      <span className="toast-fill" onAnimationEnd={() => setLeaving(id)} />
      {icon}
      <span>{children}</span>
    </div>,
    document.body,
  );
}
