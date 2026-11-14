// MFA step-up for admin actions (spec 7.2: show the code box every time). A page calls `ask(action)`; the dialog opens,
// the code the learner types is handed to `action.run` (the page puts it in the X-Demo-MFA header), and:
//   - MFA_REQUIRED / MFA_INVALID  -> the dialog stays open with the error (the learner can retype the code);
//   - any other failure           -> the dialog closes and `onSettled` gets the Thai error text;
//   - success                     -> the dialog closes and `onSettled` gets `successText`.
import { useCallback, useState, type ReactNode } from 'react';
import { MfaDialog } from '../../components';
import type { ApiResult } from '../../contracts/api-client';
import { describeError } from './problem';

export interface MfaAction {
  run: (code: string) => Promise<ApiResult<unknown>>;
  successText: string;
}

export interface MfaOutcome {
  ok: boolean;
  text: string;
}

export function useMfaGate(onSettled: (outcome: MfaOutcome) => void): { ask: (action: MfaAction) => void; busy: boolean; dialog: ReactNode } {
  const [action, setAction] = useState<MfaAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = useCallback(() => {
    setAction(null);
    setError(null);
  }, []);

  const submit = async (code: string) => {
    if (!action || busy) return;
    setBusy(true);
    try {
      const result = await action.run(code);
      if (result.ok) {
        close();
        onSettled({ ok: true, text: action.successText });
      } else if (result.error.code === 'MFA_INVALID' || result.error.code === 'MFA_REQUIRED') {
        setError(describeError(result.error));
      } else {
        close();
        onSettled({ ok: false, text: describeError(result.error) });
      }
    } finally {
      setBusy(false);
    }
  };

  const dialog = <MfaDialog open={action !== null} onSubmit={submit} onCancel={close} error={error} busy={busy} />;
  return {
    ask: (a) => {
      setError(null);
      setAction(a);
    },
    busy,
    dialog,
  };
}
