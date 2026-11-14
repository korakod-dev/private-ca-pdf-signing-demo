// Main navigation. Every page is listed for everyone: a wrong-role visit is explained by RequireRole instead of the
// link being hidden, which is part of what the demo teaches. The unread mail count comes from the demo status.
import { NavLink } from 'react-router';
import { PAGE_ROUTES, type PageKey } from '../contracts/routes';
import { useAppStore } from '../store';

/** Pages that are reached from somewhere else (a job id is needed) or are the 404 page. */
const HIDDEN: readonly PageKey[] = ['verifyResult', 'notFound'];

export function Nav() {
  const unread = useAppStore((s) => s.demo?.unread_mail ?? 0);
  const items = PAGE_ROUTES.filter((r) => !HIDDEN.includes(r.key));

  return (
    <nav aria-label="เมนูหลัก" className="border-b border-slate-300 bg-slate-100">
      <ul className="mx-auto flex max-w-5xl flex-wrap gap-x-4 gap-y-1 px-4 py-2 text-sm">
        {items.map((r) => (
          <li key={r.key}>
            <NavLink
              to={r.sample}
              end
              className={({ isActive }) =>
                `rounded px-1 py-0.5 text-blue-900 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-blue-700 ${isActive ? 'font-bold underline' : ''}`
              }
            >
              {r.title_th}
              {r.key === 'mailbox' && unread > 0 ? <span className="ml-1 rounded bg-red-800 px-1.5 text-xs text-white">{unread}</span> : null}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
