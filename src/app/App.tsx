// Router host. Sub-task D owns this folder from Phase 1 on.
import { BrowserRouter } from 'react-router';
import { AppRoutes } from './routes';

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
