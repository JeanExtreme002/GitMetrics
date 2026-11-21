import {
  Anchor,
  Avatar,
  Box,
  Button,
  Code,
  Group,
  Paper,
  Progress,
  SegmentedControl,
  Text,
  useMantineColorScheme,
  type MantineColorScheme,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconLogout, IconSettings, IconTrash } from '@tabler/icons-react';
import { MarkGithubIcon } from '@primer/octicons-react';
import { useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { PageHeader } from '../components/ui';
import { post } from '../lib/api';
import { date, num, relative } from '../lib/format';
import { useAuth, useRateLimit } from '../lib/queries';

const SOURCES = { device: 'GitHub sign-in', token: 'a personal access token', gh: 'the GitHub CLI session' };

const REPO_URL = 'https://github.com/JeanExtreme002/MyGitDash';

/** One setting: what it is on the left, the control on the right, separated by hairlines. */
function Row({ title, description, children }: { title: string; description: string; children: ReactNode }) {
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

  const clearCache = async () => {
    await post('/cache/clear');
    await client.invalidateQueries();
    notifications.show({
      message: 'Cache cleared. Pages will reload fresh data from GitHub.',
      color: 'green',
    });
  };

  const used = rate.data ? 1 - rate.data.remaining / rate.data.limit : 0;

  return (
    <Box maw={920}>
      <PageHeader
        title="Settings"
        icon={<IconSettings size={26} stroke={1.6} />}
        description="Your account, API usage and the data MyGitDash keeps on this computer."
      />

      {viewer && (
        <Paper p="lg" mb={40}>
          <Group justify="space-between" align="center" wrap="nowrap" gap="lg">
            <Group gap="md" wrap="nowrap">
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
            <Group gap="sm">
              <Button
                variant="default"
                leftSection={<MarkGithubIcon size={16} />}
                component="a"
                href={viewer.htmlUrl}
                target="_blank"
              >
                Profile
              </Button>
              <Button color="red" variant="light" leftSection={<IconLogout size={16} />} onClick={signOut}>
                Sign out
              </Button>
            </Group>
          </Group>
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
          description="GitHub allows a fixed number of requests per hour. MyGitDash caches answers, so browsing costs little."
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
          ) : (
            <Text size="sm" c="dimmed">
              Usage appears after the first request to GitHub.
            </Text>
          )}
        </Row>

        <Row
          title="Local data"
          description="Your token, pinned repositories, saved traffic history and caches. Clearing the cache keeps the traffic history."
        >
          <Group justify="space-between" wrap="nowrap">
            <Code>~/.mygitdash</Code>
            <Button variant="default" size="sm" leftSection={<IconTrash size={16} />} onClick={clearCache}>
              Clear cache
            </Button>
          </Group>
        </Row>

        <Row title="About" description="MyGitDash is open source and runs only on your computer.">
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
    </Box>
  );
}
