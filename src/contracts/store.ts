// Contract: client-side store shape. Implemented in src/store/index.ts as `useAppStore`.
// FROZEN: change only deliberately.
import type { FaultState, Instant, PersonaId, Role } from './fixtures';
import type { MissionProgress } from './engine';

export interface UserSummary {
  id: PersonaId;
  display_name: string;
  email: string;
  role: Role;
}

/** Response of GET /api/v1/demo/status. */
export interface DemoStatusDto {
  now: Instant;
  clock_mode: 'running' | 'frozen';
  faults: FaultState;
  actor: UserSummary | null;
  missions: MissionProgress[];
  /** Unread messages of the acting persona; drops to 0 after a GET demo.mailbox (F8, see MailDto in api.ts). */
  unread_mail: number;
  /** Simulated TSA offset vs NIMT in milliseconds (assumption A15). */
  tsa_offset_ms: number;
}

export interface AppStore {
  token: string | null;
  user: UserSummary | null;
  setSession(token: string, user: UserSummary): void;
  clearSession(): void;
  demo: DemoStatusDto | null;
  refreshDemoStatus(): Promise<void>;
  /** Bumped on persona switch, clock advance, fault change, reset, login/logout. Data hooks depend on it. */
  dataVersion: number;
  bumpDataVersion(): void;
}

/** localStorage key holding ONLY the session token (everything else lives in the runtime state). */
export const SESSION_STORAGE_KEY = 'pcpsd.session.v1';
