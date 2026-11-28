import {
  Anchor,
  Box,
  Button,
  Center,
  Checkbox,
  Group,
  Modal,
  Skeleton,
  Stack,
  Switch,
  Text,
} from '@mantine/core';
import { IconAppWindow, IconLayoutGrid, IconPower } from '@tabler/icons-react';
import { useEffect, useState, type ReactNode } from 'react';
import { KEEP_IT_HINT, SHORTCUT_PLACE, useInstall, useLaunch, useLaunchActions } from '../lib/launch';
import type { LaunchStatus } from '../../shared/types';
import { markStopped } from '../lib/stopped';
import { LOGO_RED, Logo } from './ui';

/*
 * Opening GitMetrics without a terminal: a shortcut among the computer's apps, starting with the
 * computer, and installing it from the browser as a window of its own. In Settings, and offered
 * once, after signing in, on each computer.
 */

/** The browser's own way: a window of its own, with an icon, from Chrome or Edge. */
function BrowserInstall() {
  const { state, install } = useInstall();
  if (state === 'installed') {
    return (
      <Text size="xs" c="dimmed">
        Running as an installed app.
      </Text>
    );
  }
  if (state === 'available') {
    return (
      <Button
        size="xs"
        variant="default"
        leftSection={<IconAppWindow size={14} />}
        onClick={() => void install()}
        w="fit-content"
      >
        Install in your browser
      </Button>
    );
  }
  return (
    <Text size="xs" c="dimmed">
      Chrome and Edge can also install it as an app, with a window of its own: look for Install in the address
      bar.
    </Text>
  );
}

/** The choices in Settings, each applied as it's switched. */
export function LaunchSetting() {
  const { data: status } = useLaunch();
  const { set, reveal } = useLaunchActions();
  if (!status) return <Skeleton height={60} radius="md" />;
  if (!status.supported || !status.platform) {
    return (
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          Shortcuts and starting with the computer aren&apos;t available on this system.
        </Text>
        <BrowserInstall />
      </Stack>
    );
  }
  return (
    <Stack gap="md">
      <Switch
        color="teal"
        label={`Add GitMetrics to ${SHORTCUT_PLACE[status.platform]}`}
        description={
          status.shortcut ? (
            <>
              {KEEP_IT_HINT[status.platform]}
              {status.platform === 'darwin' && (
                <>
                  {' '}
                  <Anchor
                    component="button"
                    size="xs"
                    c="inherit"
                    underline="always"
                    // Above the switch's own input, which covers its whole label: a click here shows the
                    // app, and leaves the switch alone.
                    style={{ position: 'relative', zIndex: 1, cursor: 'pointer' }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      reveal.mutate();
                    }}
                  >
                    Show in Finder
                  </Anchor>
                </>
              )}
            </>
          ) : (
            'Open it with a click, like any app: no terminal needed.'
          )
        }
        checked={status.shortcut}
        disabled={set.isPending}
        onChange={(e) => set.mutate({ shortcut: e.currentTarget.checked })}
      />
      <Switch
        color="teal"
        label="Start with your computer"
        description="It runs quietly in the background, always a click away, and keeps collecting traffic every day. From the next start on."
        checked={status.autostart}
        disabled={set.isPending}
        onChange={(e) => set.mutate({ autostart: e.currentTarget.checked })}
      />
      {set.error && (
        <Text size="xs" c="red.6">
          {(set.error as Error).message}
        </Text>
      )}
      <BrowserInstall />
    </Stack>
  );
}

/** Quitting GitMetrics, which runs in the background without a terminal to stop it from. */
export function QuitSetting() {
  const { quit } = useLaunchActions();
  return (
    // On the right, as the other rows' buttons are.
    <Group justify="flex-end">
      <Button
        variant="default"
        w="fit-content"
        loading={quit.isPending}
        // Stopped, nothing in the app works any more: it gives way to a page that says so.
        onClick={() => quit.mutate(undefined, { onSuccess: markStopped })}
      >
        Quit GitMetrics
      </Button>
    </Group>
  );
}

/** What's left once GitMetrics has stopped: one plain page, saying so. */
export function StoppedPage() {
  useEffect(() => {
    document.title = 'GitMetrics has stopped';
  }, []);
  return (
    <Center mih="100dvh" p="lg">
      <Stack align="center" gap={0} maw={420} ta="center">
        <Logo size={44} />
        <Text fw={700} fz={22} mt="lg">
          GitMetrics has stopped
        </Text>
        <Text c="dimmed" mt={8}>
          You can close this page.
        </Text>
        <Text size="sm" c="dimmed" mt="xl">
          Open it again whenever you like.
        </Text>
      </Stack>
    </Center>
  );
}

/**
 * The picture at the top of the offer: a dock of apps, and GitMetrics dropping into it with a soft
 * bounce, then lit as running. Still for those who prefer less motion.
 */
function LaunchIllustration() {
  const slot = (x: number, key: number) => (
    <rect key={key} x={x} y={92} width={40} height={40} rx={11} className="launch-slot" />
  );
  return (
    // Where the modal's focus starts: on the picture, so no choice opens already outlined.
    <Box className="launch-hero" aria-hidden tabIndex={-1} data-autofocus>
      <svg viewBox="0 0 392 160" width="100%" role="presentation">
        <defs>
          <radialGradient id="launch-glow" cx="50%" cy="72%" r="55%">
            <stop offset="0%" stopColor="#e5383b" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#e5383b" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="392" height="160" fill="url(#launch-glow)" />
        {/* The dock, its apps, and the place GitMetrics drops into. */}
        <rect x={66} y={82} width={260} height={60} rx={18} className="launch-dock" />
        {[80, 128, 176, 272].map(slot)}
        <g className="launch-ring">
          <circle cx={244} cy={112} r={24} fill="none" stroke="#e5383b" strokeWidth={2} />
        </g>
        <g className="launch-drop">
          <rect x={222} y={90} width={44} height={44} rx={12} className="launch-tile" />
          {/* The logo drawn here, as favicon.svg draws it: nothing to fetch, so it comes with the tile. */}
          <svg x={226} y={94} width={36} height={36} viewBox="0 0 128 128">
            <mask id="launch-logo">
              <rect x="20" y="20" width="88" height="88" rx="16" transform="rotate(45 64 64)" fill="#fff" />
              <path
                d="M44 88 V76 M60 88 V68 M76 88 V60"
                stroke="#000"
                strokeWidth="9"
                strokeLinecap="round"
              />
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
            <rect width="128" height="128" fill={LOGO_RED} mask="url(#launch-logo)" />
          </svg>
        </g>
        <circle cx={244} cy={140} r={2.5} className="launch-running" />
      </svg>
    </Box>
  );
}

/** One of the offer's choices: a card with its icon, what it does, and its box. */
function Choice({
  icon,
  title,
  description,
  checked,
  onChange,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Checkbox.Card className="launch-choice" radius="md" checked={checked} onClick={() => onChange(!checked)}>
      <Group wrap="nowrap" align="flex-start" gap="md">
        <span className="launch-choice-icon">{icon}</span>
        <Box style={{ flex: 1 }} miw={0}>
          <Text size="sm" fw={600}>
            {title}
          </Text>
          <Text size="xs" c="dimmed" mt={2}>
            {description}
          </Text>
        </Box>
        <Checkbox.Indicator color="teal" radius="sm" mt={2} />
      </Group>
    </Checkbox.Card>
  );
}

/** Once it's among the apps, how to keep it at hand: the Dock or a taskbar is the person's own. */
const KEEP_IT: Record<NonNullable<LaunchStatus['platform']>, { title: string; text: string }> = {
  darwin: {
    title: 'Keep it in your Dock',
    text: "It's in Applications, in your home folder. Show it in the Finder, then drag it to the Dock to keep it there.",
  },
  win32: {
    title: 'Keep it in your taskbar',
    text: "It's in the Start menu now, in All apps. Right‑click it there, then More and Pin to taskbar.",
  },
  linux: {
    title: 'Keep it at hand',
    text: "It's in your apps menu now. Right‑click it there to pin it to your dock or panel, a click away.",
  },
};

/** Offered once on each computer, after signing in: the two choices, the shortcut ticked. */
export function LaunchOffer() {
  const { data: status } = useLaunch();
  const { set, offered, reveal } = useLaunchActions();
  const [shortcut, setShortcut] = useState(true);
  const [autostart, setAutostart] = useState(false);
  const [closed, setClosed] = useState(false);
  // Added: the offer stays a moment to say how to keep it at hand.
  const [added, setAdded] = useState(false);
  const opened = Boolean(status?.supported && status.platform && (!status.offered || added) && !closed);
  const later = () => {
    setClosed(true);
    if (!added) offered.mutate();
  };
  const accept = () =>
    set.mutate(
      { shortcut, autostart },
      {
        onSuccess: () => (shortcut ? setAdded(true) : setClosed(true)),
      },
    );
  return (
    <Modal
      opened={opened}
      onClose={later}
      size={460}
      radius="lg"
      centered
      padding={0}
      withCloseButton={false}
      aria-label="Open GitMetrics like any app"
    >
      <LaunchIllustration />
      {added && status?.platform ? (
        <Box p={24} pt={20}>
          <Text fw={700} fz={22} lh={1.25} ta="center">
            {KEEP_IT[status.platform].title}
          </Text>
          <Text size="sm" c="dimmed" ta="center" mt={8} maw={360} mx="auto" style={{ textWrap: 'balance' }}>
            {KEEP_IT[status.platform].text}
          </Text>
          <Group justify={status.platform === 'darwin' ? 'space-between' : 'flex-end'} mt={24}>
            {status.platform === 'darwin' && (
              <Anchor component="button" size="sm" c="dimmed" onClick={() => reveal.mutate()}>
                Show in Finder
              </Anchor>
            )}
            <Button variant="default" onClick={() => setClosed(true)}>
              Done
            </Button>
          </Group>
        </Box>
      ) : (
        <Box p={24} pt={20}>
          <Text fw={700} fz={22} lh={1.25} ta="center">
            Open GitMetrics like any app
          </Text>
          <Text size="sm" c="dimmed" ta="center" mt={8} maw={360} mx="auto">
            No terminal needed: just a click away.
          </Text>
          {status?.platform && (
            <Stack gap={10} mt={22}>
              <Choice
                icon={<IconLayoutGrid size={18} stroke={1.7} />}
                title={`Add it to ${SHORTCUT_PLACE[status.platform]}`}
                description="Open it with a click, from among your apps."
                checked={shortcut}
                onChange={setShortcut}
              />
              <Choice
                icon={<IconPower size={18} stroke={1.7} />}
                title="Start it with your computer"
                description="Quietly, in the background, so your traffic is collected every day."
                checked={autostart}
                onChange={setAutostart}
              />
              {/* About the choices, beside them. */}
              <Text size="xs" c="dimmed">
                You can change this whenever you like, in Settings.
              </Text>
            </Stack>
          )}
          {set.error && (
            <Text size="xs" c="red.6" mt="sm">
              {(set.error as Error).message}
            </Text>
          )}
          <Group justify="space-between" mt={24}>
            <Anchor component="button" size="sm" c="dimmed" onClick={later}>
              Not now
            </Anchor>
            <Button
              // Welcoming, not pressing: the green of the choices ticked above, on the one way forward.
              variant="filled"
              color="teal.7"
              disabled={!shortcut && !autostart}
              loading={set.isPending}
              onClick={accept}
            >
              Let&apos;s do it
            </Button>
          </Group>
        </Box>
      )}
    </Modal>
  );
}
