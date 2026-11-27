import {
  Anchor,
  Avatar,
  Box,
  Button,
  Code,
  Flex,
  Group,
  Paper,
  Progress,
  SegmentedControl,
  Skeleton,
  Text,
  useMantineColorScheme,
  type MantineColorScheme,
} from '@mantine/core';
import { IconCheck, IconLogout, IconSettings, IconTrash } from '@tabler/icons-react';
import { MarkGithubIcon } from '@primer/octicons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { PageHeader, Toast } from '../components/ui';
import { post } from '../lib/api';
import { date, num, relative } from '../lib/format';
import { useAuth, useRateLimit } from '../lib/queries';
import { LaunchSetting, QuitSetting } from '../components/launch';

const SOURCES = { device: 'GitHub sign-in', token: 'a personal access token', gh: 'the GitHub CLI session' };

const REPO_URL = 'https://github.com/JeanExtreme002/GitMetrics';

/** One setting: what it is on the left, the control on the right, separated by hairlines. */
function Row({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="setting-row">
      <Box>
        <Text fw={600} size="sm">
          {title}
        </Text>
        <Text size="sm" c="dimmed" mt={2}>
          {description}
        </Text>
      </Box>
      <Box>{children}</Box>
    </div>
  );
}

export function Settings() {
  const { data } = useAuth();
  const rate = useRateLimit();
  const client = useQueryClient();
  const navigate = useNavigate();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const viewer = data?.viewer;

  const signOut = async () => {
    await post('/auth/logout');
    client.clear();
    navigate('/login');
  };

  const [clearing, setClearing] = useState(false);
  const [toast, setToast] = useState(0);
  const clearCache = async () => {
    setClearing(true);
    try {
      await post('/cache/clear');
    } finally {
      setClearing(false);
    }
    // Said as soon as it's done: the pages reload in the background, and waiting on them (your
    // repositories take seconds) would leave the button looking like it did nothing.
    setToast(Date.now());
    void client.invalidateQueries();
  };

  const used = rate.data ? 1 - rate.data.remaining / rate.data.limit : 0;

  return (
    <Box maw={920}>
      <PageHeader
        title="Settings"
        icon={<IconSettings size={26} stroke={1.6} />}
        description="Your account, API usage and the data GitMetrics keeps on this computer."
      />

      {viewer && (
        <Paper p="lg" mb={40}>
          {/* Side by side on a wide screen; on a phone, who you are first and the buttons under it. */}
          <Flex
            direction={{ base: 'column', sm: 'row' }}
            justify="space-between"
            align={{ base: 'stretch', sm: 'center' }}
            gap="lg"
          >
            <Group gap="md" wrap="nowrap" align="flex-start">
              <Avatar src={viewer.avatarUrl} size={56} radius="xl" />
              <Box>
                <Text fw={600} size="lg">
                  {viewer.name ?? viewer.login}
                </Text>
                <Text size="sm" c="dimmed">
                  @{viewer.login} · member since {date(viewer.createdAt)}
                </Text>
                <Text size="sm" c="dimmed" mt={6}>
                  Signed in with {SOURCES[data?.source ?? 'token']}
                </Text>
                {Boolean(data?.scopes?.length) && (
                  <Text size="xs" c="dimmed" mt={2}>
                    Permissions: {data!.scopes!.join(', ')}
                  </Text>
                )}
              </Box>
            </Group>
            <Group gap="sm" wrap="nowrap" className="profile-actions">
              <Button
                variant="default"
                leftSection={<MarkGithubIcon size={16} />}
                component="a"
                href={viewer.htmlUrl}
                target="_blank"
              >
                Profile
              </Button>
              <Button
                variant="default"
                className="sign-out"
                leftSection={<IconLogout size={16} />}
                onClick={signOut}
              >
                Sign out
              </Button>
            </Group>
          </Flex>
        </Paper>
      )}

      <div className="settings-list">
        <Row title="Appearance" description="Follow your system, or pick a theme.">
          <SegmentedControl
            value={colorScheme}
            onChange={(v) => setColorScheme(v as MantineColorScheme)}
            data={[
              { label: 'System', value: 'auto' },
              { label: 'Light', value: 'light' },
              { label: 'Dark', value: 'dark' },
            ]}
          />
        </Row>

        <Row
          title="API usage"
          description="GitHub allows a fixed number of requests per hour. GitMetrics caches answers, so browsing costs little."
        >
          {rate.data ? (
            <Box>
              <Group justify="space-between" mb={8}>
                <Text size="sm">
                  <b className="tabular">{num(rate.data.remaining)}</b> of {num(rate.data.limit)} left
                </Text>
                <Text size="sm" c="dimmed">
                  Resets {relative(rate.data.resetAt)}
                </Text>
              </Group>
              <Progress value={(1 - used) * 100} color={used > 0.85 ? 'red' : 'gray'} size="sm" radius="xl" />
            </Box>
          ) : rate.isLoading ? (
            // Read at once: its place held, not "no usage yet" for a moment.
            <Box aria-busy="true">
              <Group justify="space-between" mb={8}>
                <Skeleton height={12} width={140} radius="xl" />
                <Skeleton height={12} width={90} radius="xl" />
              </Group>
              <Skeleton height={8} radius="xl" />
            </Box>
          ) : (
            <Text size="sm" c="dimmed">
              Usage appears after the first request to GitHub.
            </Text>
          )}
        </Row>

        <Row
          title="Open like an app"
          description="Open GitMetrics without a terminal: from a shortcut among your apps, or started with your computer."
        >
          <LaunchSetting />
        </Row>

        <Row
          title="Local data"
          description="Your token, pinned repositories, saved traffic history and caches. Clearing the cache keeps the traffic history."
        >
          <Group justify="space-between" wrap="nowrap">
            <Code>~/.gitmetrics</Code>
            <Button
              variant="default"
              size="sm"
              leftSection={<IconTrash size={16} />}
              onClick={clearCache}
              loading={clearing}
            >
              Clear cache
            </Button>
          </Group>
        </Row>

        <Row
          title="Quit"
          description="Stops GitMetrics on this computer, as Ctrl+C in its terminal would. Open it again from its shortcut."
        >
          <QuitSetting />
        </Row>

        <Row
          title="About"
          description={
            // Attribution required by the additional terms in NOTICE (AGPL-3.0, section 7(b)).
            <>
              Based on{' '}
              <Anchor href={REPO_URL} target="_blank" inherit underline="always">
                GitMetrics
              </Anchor>{' '}
              by Jean Loui Bernard Silva de Jesus. Free software under the{' '}
              <Anchor href={`${REPO_URL}/blob/main/LICENSE`} target="_blank" inherit underline="always">
                GNU AGPL-3.0
              </Anchor>
              , with no warranty.
            </>
          }
        >
          <Group justify="space-between" wrap="nowrap">
            <Text size="sm">Version {__APP_VERSION__}</Text>
            <Group gap="lg">
              <Anchor href={REPO_URL} target="_blank" size="sm">
                Source code
              </Anchor>
              <Anchor href={`${REPO_URL}/issues/new/choose`} target="_blank" size="sm">
                Report a problem
              </Anchor>
            </Group>
          </Group>
        </Row>
      </div>
      <Toast id={toast} icon={<IconCheck size={15} stroke={2.4} className="toast-icon" />}>
        Cache cleared
      </Toast>
    </Box>
  );
}
