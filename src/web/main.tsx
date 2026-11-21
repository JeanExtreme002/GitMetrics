import '@fontsource-variable/mona-sans';
import '@mantine/core/styles.css';
import '@mantine/charts/styles.css';
import '@mantine/spotlight/styles.css';
import '@mantine/notifications/styles.css';
import './styles.css';

import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ApiError } from './lib/api';
import { theme } from './theme';

const client: QueryClient = new QueryClient({
  queryCache: new QueryCache({
    // A revoked or expired token sends the user back to the sign-in screen.
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) {
        void client.invalidateQueries({ queryKey: ['auth'] });
      }
    },
  }),
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <Notifications position="bottom-right" />
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>,
);
