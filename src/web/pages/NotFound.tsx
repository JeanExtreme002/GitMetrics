import { Button } from '@mantine/core';
import { IconMapOff } from '@tabler/icons-react';
import { Link } from 'react-router';
import { EmptyState } from '../components/ui';

export function NotFound() {
  return (
    <EmptyState
      icon={<IconMapOff size={28} stroke={1.5} />}
      title="This page does not exist"
      description="The link may be broken, or the page may have moved."
      action={
        <Button component={Link} to="/" variant="light">
          Back to home
        </Button>
      }
    />
  );
}
