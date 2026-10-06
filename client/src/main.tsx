import React from 'react';
import ReactDOM from 'react-dom/client';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import ToastProvider, { errorMessage, toast } from './components/Toast';
import { ThemeProvider } from './context/ThemeContext';
import './index.css';

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: error => toast.error(errorMessage(error)) }),
  mutationCache: new MutationCache({ onError: error => toast.error(errorMessage(error)) }),
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 30_000,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <App />
        <ToastProvider />
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
