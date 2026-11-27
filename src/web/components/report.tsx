import {
  Anchor,
  Box,
  Button,
  Checkbox,
  Collapse,
  Group,
  Loader,
  Modal,
  SegmentedControl,
  Stack,
  Text,
} from '@mantine/core';
import {
  IconArrowLeft,
  IconBook2,
  IconCalendarMonth,
  IconDownload,
  IconFileText,
  IconTimeline,
} from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { ActivityCommentedResponse, ActivityResponse } from '../../shared/types';
import { api, post } from '../lib/api';
import { dayLabel, num } from '../lib/format';
import { activityPath, useActivityCommented } from '../lib/queries';
import {
  DEFAULT_REPORT,
  buildReport,
  reportContents,
  reportFileName,
  type ReportOptions,
} from '../lib/report';

/** A heading over a few choices. */
function Heading({ children }: { children: ReactNode }) {
  return (
    <Text size="sm" fw={600} className="report-heading">
      {children}
    </Text>
  );
}

/** One choice: a box, what it is, and how many it holds on the right. */
function Choice({
  label,
  count,
  checked,
  onChange,
  sub,
  loading,
}: {
  label: string;
  count?: number;
  /** Its count is still being found. */
  loading?: boolean;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** A choice under another, set in. */
  sub?: boolean;
}) {
  return (
    <Group justify="space-between" wrap="nowrap" className={sub ? 'report-choice sub' : 'report-choice'}>
      <Checkbox
        color="teal"
        size="sm"
        radius="sm"
        label={label}
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
      {loading ? (
        <Loader size={14} color="gray" aria-label="Counting" />
      ) : (
        count !== undefined && (
          <Text size="sm" c="dimmed" className="tabular">
            {num(count)}
          </Text>
        )
      )}
    </Group>
  );
}

/** The ways to lay the report out, each with its icon. */
const ARRANGE = [
  { value: 'timeline', label: 'Timeline', icon: IconTimeline },
  { value: 'repo', label: 'Repository', icon: IconBook2 },
  { value: 'month', label: 'Month', icon: IconCalendarMonth },
] as const;

/** How the report is laid out, in a word, for what's said about the file. */
const LAYOUT: Record<ReportOptions['groupBy'], string> = {
  timeline: 'As a timeline',
  repo: 'By repository',
  month: 'By month',
};

/** Descriptions asked for at a time, within what the server takes in one asking. */
const DESCRIPTIONS_PER_ASK = 500;

/** A file's size, as "12 KB". */
const size = (bytes: number) =>
  bytes < 1024 ? `${num(bytes)} bytes` : `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;

type Step =
  | { kind: 'choose'; error?: string }
  | { kind: 'making'; what: string }
  | { kind: 'ready'; markdown: string; pulls: number };

/**
 * Someone's pull requests as a Markdown file: what goes in is picked, then it's made, reading from
 * GitHub only what was asked for and isn't on the page yet, then it's there to download.
 */
export function ReportModal({
  opened,
  onClose,
  data,
  where,
  range,
}: {
  opened: boolean;
  onClose: () => void;
  data: ActivityResponse;
  where: string;
  range: string;
}) {
  const client = useQueryClient();
  const [options, setOptions] = useState<ReportOptions>(DEFAULT_REPORT);
  const [step, setStep] = useState<Step>({ kind: 'choose' });
  const login = data.user.login;
  const place = data.scope.kind === 'all' ? 'All of GitHub' : data.scope.name;

  const mine = data.pulls.opened;
  const counts = {
    merged: mine.filter((p) => p.state === 'merged').length,
    open: mine.filter((p) => p.state === 'open' && !p.draft).length,
    drafts: mine.filter((p) => p.state === 'open' && p.draft).length,
    closed: mine.filter((p) => p.state === 'closed').length,
  };
  const reviewing = options.reviewed.reviews !== 'none';
  // Those they only commented on take a search of their own: made once the box is ticked (or
  // already made, by the Commented list on the page), and counted then.
  const commentedQuery = useActivityCommented(login, where, range, options.reviewed.commented);
  const reviewedKeys = new Set(data.pulls.reviewed.map((p) => `${p.repo}#${p.number}`));
  const commentedCount = commentedQuery.data?.pulls.filter(
    (p) => !reviewedKeys.has(`${p.repo}#${p.number}`),
  ).length;
  const contents = useMemo(() => reportContents({ activity: data, options }), [data, options]);
  const nothing = contents.opened.length + contents.reviewed.length === 0 && !options.reviewed.commented;

  const setOpened = (next: Partial<ReportOptions['opened']>) =>
    setOptions((o) => ({ ...o, opened: { ...o.opened, ...next } }));
  const setReviewed = (next: Partial<ReportOptions['reviewed']>) =>
    setOptions((o) => ({ ...o, reviewed: { ...o.reviewed, ...next } }));

  // Which making is current: closing the modal ends one, so a late answer doesn't come back as done.
  const run = useRef(0);

  const make = async () => {
    const ticket = ++run.current;
    const current = () => run.current === ticket;
    try {
      // Only what's asked for and not on the page: each one's description, the ones commented on.
      const descriptions: Record<string, string> = {};
      const ids = options.opened.descriptions ? contents.opened.map((p) => p.id).filter(Boolean) : [];
      // In parts, as a long period of a busy person can hold more than one asking takes.
      for (let i = 0; i < ids.length && current(); i += DESCRIPTIONS_PER_ASK) {
        setStep({
          kind: 'making',
          what:
            ids.length > DESCRIPTIONS_PER_ASK
              ? `Reading descriptions… ${num(i)} of ${num(ids.length)}`
              : 'Reading descriptions…',
        });
        const part = ids.slice(i, i + DESCRIPTIONS_PER_ASK);
        Object.assign(
          descriptions,
          (await post<{ descriptions: Record<string, string> }>('/activity/descriptions', { ids: part }))
            .descriptions,
        );
      }
      let commented: ActivityCommentedResponse | undefined;
      if (options.reviewed.commented) {
        setStep({ kind: 'making', what: 'Finding what they commented on…' });
        // The same as the Commented list on the page, so one read serves both.
        commented = await client.fetchQuery({
          queryKey: ['activity-commented', login.toLowerCase(), where.toLowerCase(), range],
          queryFn: () => api<ActivityCommentedResponse>(activityPath(login, where, range, '/commented')),
          staleTime: 10 * 60_000,
        });
      }
      if (!current()) return;
      const input = { activity: data, options, descriptions, commented: commented?.pulls };
      const parts = reportContents(input);
      setStep({
        kind: 'ready',
        markdown: buildReport(input),
        pulls: parts.opened.length + parts.reviewed.length + parts.commented.length,
      });
    } catch (error) {
      if (!current()) return;
      setStep({
        kind: 'choose',
        error: error instanceof Error ? error.message : "The report couldn't be made.",
      });
    }
  };

  const download = (markdown: string) => {
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = reportFileName(data);
    // In the page while clicked, and the file let go only after: some browsers drop a download
    // whose address is gone, or whose link was never in the page.
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  const close = () => {
    // A report being made is let go: it won't come back as done when the modal opens again.
    run.current++;
    onClose();
    // Back to the choices next time, kept as they were.
    setTimeout(() => setStep({ kind: 'choose' }), 200);
  };

  return (
    <Modal
      opened={opened}
      onClose={close}
      size={440}
      radius="lg"
      centered
      padding={24}
      // Room enough on a short window, so it fits whole rather than scrolling.
      yOffset="2dvh"
      title={
        <Box>
          <Text fw={650} size="lg" lh={1.2}>
            Report
          </Text>
          <Text size="sm" c="dimmed" mt={4}>
            @{login} · {dayLabel(data.from)} – {dayLabel(data.to)} · {place}
          </Text>
        </Box>
      }
    >
      {step.kind === 'choose' && (
        <>
          <Stack gap={20} mt={4}>
            <Box>
              <Heading>Pull requests they opened</Heading>
              <Choice
                label="Merged"
                count={counts.merged}
                checked={options.opened.merged}
                onChange={(v) => setOpened({ merged: v })}
              />
              <Choice
                label="Open"
                count={counts.open}
                checked={options.opened.open}
                onChange={(v) => setOpened({ open: v })}
              />
              <Choice
                label="Draft"
                count={counts.drafts}
                checked={options.opened.drafts}
                onChange={(v) => setOpened({ drafts: v })}
              />
              <Choice
                label="Closed"
                count={counts.closed}
                checked={options.opened.closed}
                onChange={(v) => setOpened({ closed: v })}
              />
              {/* Not which ones, but what each one brings: apart from the choices above. */}
              <Box mt={6}>
                <Choice
                  label="Include descriptions"
                  checked={options.opened.descriptions}
                  onChange={(v) => setOpened({ descriptions: v })}
                />
              </Box>
            </Box>

            <Box>
              <Heading>Pull requests they reviewed</Heading>
              <Choice
                label="All they reviewed"
                count={data.pulls.reviewed.length}
                checked={reviewing}
                onChange={(v) => setReviewed({ reviews: v ? 'any' : 'none' })}
              />
              <Collapse expanded={reviewing}>
                <Choice
                  sub
                  label="Only ones they approved"
                  checked={options.reviewed.reviews === 'approved'}
                  onChange={(v) => setReviewed({ reviews: v ? 'approved' : 'any' })}
                />
                <Choice
                  sub
                  label="Only ones that were merged"
                  checked={options.reviewed.onlyMerged}
                  onChange={(v) => setReviewed({ onlyMerged: v })}
                />
              </Collapse>
              <Choice
                label="Ones they only commented on"
                count={commentedCount}
                loading={
                  options.reviewed.commented && commentedQuery.isFetching && commentedCount === undefined
                }
                checked={options.reviewed.commented}
                onChange={(v) => setReviewed({ commented: v })}
              />
            </Box>

            <Box>
              <Heading>Arrange by</Heading>
              <SegmentedControl
                fullWidth
                mt={6}
                radius="md"
                withItemsBorders={false}
                className="report-arrange"
                // Set on the control itself: Mantine's own background would win over a class.
                styles={{ root: { background: 'var(--report-track)' } }}
                value={options.groupBy}
                onChange={(v) => setOptions((o) => ({ ...o, groupBy: v as ReportOptions['groupBy'] }))}
                data={ARRANGE.map(({ value, label, icon: ArrangeIcon }) => ({
                  value,
                  label: (
                    <Group gap={6} justify="center" wrap="nowrap">
                      <ArrangeIcon size={15} stroke={1.7} />
                      {label}
                    </Group>
                  ),
                }))}
              />
            </Box>
          </Stack>

          {step.error && (
            <Text size="sm" c="red.6" mt="lg">
              {step.error}
            </Text>
          )}
          <Group justify="flex-end" mt={22}>
            <Button
              variant="default"
              leftSection={<IconFileText size={16} stroke={1.7} />}
              disabled={nothing}
              onClick={make}
            >
              Generate
            </Button>
          </Group>
        </>
      )}

      {step.kind === 'making' && (
        <Stack align="center" gap="sm" py={64}>
          <Loader size="sm" type="dots" />
          <Text size="sm" c="dimmed">
            {step.what}
          </Text>
        </Stack>
      )}

      {step.kind === 'ready' && (
        <>
          {/* The file, as a file: its page with the corner turned, its name, and what's in it. */}
          <Group gap={16} wrap="nowrap" className="report-file" mt={4}>
            <span className="report-page" aria-hidden>
              MD
            </span>
            <Box miw={0}>
              <Text fw={600} truncate>
                {reportFileName(data)}
              </Text>
              <Text size="sm" c="dimmed" mt={2}>
                {num(step.pulls)} pull requests · {size(new Blob([step.markdown]).size)}
              </Text>
              <Text size="xs" c="dimmed" mt={6}>
                {[
                  LAYOUT[options.groupBy],
                  options.opened.descriptions && contents.opened.length ? 'with descriptions' : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </Box>
          </Group>
          <Button
            fullWidth
            mt={20}
            variant="default"
            leftSection={<IconDownload size={16} />}
            onClick={() => download(step.markdown)}
          >
            Download
          </Button>
          <Anchor
            component="button"
            size="sm"
            c="dimmed"
            mt={16}
            className="report-back"
            onClick={() => setStep({ kind: 'choose' })}
          >
            <IconArrowLeft size={14} />
            Back to options
          </Anchor>
        </>
      )}
    </Modal>
  );
}
