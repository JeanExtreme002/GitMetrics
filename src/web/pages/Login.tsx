import {
  Anchor,
  Box,
  Button,
  Center,
  Collapse,
  CopyButton,
  Divider,
  Group,
  Loader,
  Paper,
  PasswordInput,
  Stack,
  Text,
  Title,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { IconCheck, IconChevronDown, IconCopy, IconExternalLink } from '@tabler/icons-react';
import { MarkGithubIcon } from '@primer/octicons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router';
import type { DevicePoll, DeviceStart } from '../../shared/types';
import { Logo } from '../components/ui';
import { post } from '../lib/api';
import { useAuth } from '../lib/queries';

const TOKEN_URL =
  'https://github.com/settings/tokens/new?scopes=repo,read:user,read:org&description=GitMetrics';

function DeviceCode({ flow, onCancel }: { flow: DeviceStart; onCancel: () => void }) {
  return (
    <Stack gap="md" align="center" ta="center">
      <Text size="sm" c="dimmed">
        Enter this code on GitHub to authorize GitMetrics
      </Text>
      <Group gap="xs">
        <Text className="user-code">{flow.userCode}</Text>
        <CopyButton value={flow.userCode}>
          {({ copied, copy }) => (
            <Tooltip label={copied ? 'Copied' : 'Copy code'}>
              <Button variant="subtle" color={copied ? 'green' : 'gray'} px={8} onClick={copy}>
                {copied ? <IconCheck size={18} /> : <IconCopy size={18} />}
              </Button>
            </Tooltip>
          )}
        </CopyButton>
      </Group>
      <Button
        component="a"
        href={flow.verificationUri}
        target="_blank"
        rel="noreferrer"
        fullWidth
        size="md"
        rightSection={<IconExternalLink size={16} />}
      >
        Open github.com/login/device
      </Button>
      <Group gap="xs" c="dimmed">
        <Loader size={14} />
        <Text size="sm">Waiting for you to approve on GitHub…</Text>
      </Group>
      <Anchor component="button" size="sm" c="dimmed" onClick={onCancel}>
        Cancel
      </Anchor>
    </Stack>
  );
}

export function Login() {
  const { data, isLoading } = useAuth();
  const client = useQueryClient();
  const [flow, setFlow] = useState<DeviceStart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'device' | 'gh' | 'token' | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [token, setToken] = useState('');
  const timer = useRef<number | undefined>(undefined);

  const finish = async () => {
    await client.invalidateQueries({ queryKey: ['auth'] });
  };

  const run = async (kind: 'gh' | 'token', action: () => Promise<unknown>) => {
    setError(null);
    setBusy(kind);
    try {
      await action();
      await finish();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign in failed.');
    } finally {
      setBusy(null);
    }
  };

  const startDevice = async () => {
    setError(null);
    setBusy('device');
    try {
      setFlow(await post<DeviceStart>('/auth/device/start'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach GitHub.');
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (!flow) return;
    let interval = flow.interval;
    let cancelled = false;
    const tick = async () => {
      try {
        const result = await post<DevicePoll>('/auth/device/poll');
        if (cancelled) return;
        if (result.status === 'complete') return void finish();
        if (result.status !== 'pending') {
          setFlow(null);
          setError(
            result.status === 'denied'
              ? 'The authorization was declined on GitHub.'
              : 'The code expired. Start again to get a new one.',
          );
          return;
        }
        interval = result.interval ?? interval;
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Sign in failed.');
      }
      if (!cancelled) timer.current = window.setTimeout(tick, interval * 1000);
    };
    timer.current = window.setTimeout(tick, interval * 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow]);

  if (isLoading) return null;
  if (data?.authenticated) return <Navigate to="/" replace />;

  const methods = data?.methods ?? { device: false, gh: false };
  const tokenOpen = showToken || (!methods.device && !methods.gh);

  return (
    <Center className="login-page" p="md">
      <Box w="100%" maw={420}>
        <Stack align="center" gap={6} mb="xl" ta="center">
          <Logo size={52} />
          <Title order={1} fz={28} mt="sm">
            Welcome to GitMetrics
          </Title>
          <Text c="dimmed">Everything about your repositories, in one calm place.</Text>
        </Stack>

        <Paper p="xl" shadow="sm">
          {flow ? (
            <DeviceCode flow={flow} onCancel={() => setFlow(null)} />
          ) : (
            <Stack gap="sm">
              {methods.device && (
                <Button
                  size="md"
                  color="dark"
                  leftSection={<MarkGithubIcon size={18} />}
                  onClick={startDevice}
                  loading={busy === 'device'}
                >
                  Sign in with GitHub
                </Button>
              )}
              {methods.gh && (
                <Button
                  size="md"
                  variant="default"
                  leftSection={<MarkGithubIcon size={18} />}
                  onClick={() => run('gh', () => post('/auth/gh'))}
                  loading={busy === 'gh'}
                >
                  Continue with GitHub CLI
                </Button>
              )}

              {(methods.device || methods.gh) && (
                <Divider
                  my="xs"
                  labelPosition="center"
                  label={
                    <UnstyledButton onClick={() => setShowToken((v) => !v)}>
                      <Group gap={4}>
                        <Text size="xs" c="dimmed">
                          Use a personal access token
                        </Text>
                        <IconChevronDown
                          size={14}
                          style={{
                            transform: tokenOpen ? 'rotate(180deg)' : undefined,
                            transition: 'transform 150ms',
                          }}
                        />
                      </Group>
                    </UnstyledButton>
                  }
                />
              )}

              <Collapse expanded={tokenOpen}>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run('token', () => post('/auth/token', { token }));
                  }}
                >
                  <Stack gap="sm">
                    <PasswordInput
                      label="Personal access token"
                      placeholder="ghp_…"
                      value={token}
                      onChange={(e) => setToken(e.currentTarget.value)}
                      autoComplete="off"
                    />
                    <Text size="xs" c="dimmed">
                      Needs the <b>repo</b> and <b>read:user</b> scopes.{' '}
                      <Anchor href={TOKEN_URL} target="_blank" size="xs">
                        Create one on GitHub
                      </Anchor>
                    </Text>
                    <Button type="submit" variant="light" loading={busy === 'token'} disabled={!token.trim()}>
                      Sign in with token
                    </Button>
                  </Stack>
                </form>
              </Collapse>
            </Stack>
          )}

          {error && (
            <Text c="red" size="sm" mt="md" ta="center">
              {error}
            </Text>
          )}
        </Paper>

        <Text size="xs" c="dimmed" ta="center" mt="lg">
          GitMetrics runs only on this computer. Your token is stored in ~/.gitmetrics and is sent to nothing
          but the GitHub API.
        </Text>
      </Box>
    </Center>
  );
}
