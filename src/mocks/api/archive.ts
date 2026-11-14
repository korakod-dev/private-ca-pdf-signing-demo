// Real-contract handlers: document archive (list/add/share) and the user directory used by "share".
import type { RouteKey } from '../../contracts/routes';
import { handlersFor } from '../engineHandler';
import type { RuntimeLike } from '../engineHandler';

export const ARCHIVE_KEYS = ['archive.list', 'archive.add', 'archive.share', 'users.directory'] as const satisfies readonly RouteKey[];

export const archiveHandlers = (runtime: RuntimeLike) => handlersFor(ARCHIVE_KEYS, runtime);
