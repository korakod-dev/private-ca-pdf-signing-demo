// /sign - sign desk (spec 7.6 row 7, 7.7). Two ways to run the same command code:
//   terminal mode (default): type `pdfsign sign ...` in the simulated terminal;
//   button mode (TID.sign.modeToggle): a form that drives the same pdfsign command (see ops/SignWizard).
// Page content is wrapped in <RequireRole>: people who can hold a certificate (signer, new user, user).
import { useState } from 'react';
import { RequireRole } from '../app/RequireRole';
import { Button, Card, LayeredContent } from '../components';
import { getMarkdown as getOpsMarkdown } from './ops/content';
import { TID } from '../contracts/testids';
import { TERMINAL_WELCOME, TerminalView } from '../terminal';
import { SignWizard } from './ops/SignWizard';

type Mode = 'terminal' | 'buttons';

const SIGN_WELCOME = [...TERMINAL_WELCOME, 'ลอง: pdfsign sign ~/Documents/memo-130-unsigned.pdf --field "approver-1" --certify'];

export function SignPage() {
  const [mode, setMode] = useState<Mode>('terminal');

  return (
    <section data-testid={TID.page('sign')}>
      <h1 className="text-2xl font-bold">โต๊ะเซ็นเอกสาร</h1>
      <RequireRole roles={['signer', 'new_user', 'user']}>
        <div className="mt-3 space-y-4">
          <LayeredContent markdown={getOpsMarkdown('sign', 'desk')} />

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              data-testid={TID.sign.modeToggle}
              data-mode={mode}
              aria-pressed={mode === 'buttons'}
              onClick={() => setMode((m) => (m === 'terminal' ? 'buttons' : 'terminal'))}
            >
              โหมดปุ่มกด (ไม่ต้องพิมพ์คำสั่ง)
            </Button>
            <span className="text-sm text-slate-700">{mode === 'buttons' ? 'ตอนนี้: โหมดปุ่มกด' : 'ตอนนี้: โหมดคำสั่ง'}</span>
          </div>

          {mode === 'terminal' ? (
            <Card title="เทอร์มินัลจำลอง" headingLevel={2}>
              <TerminalView welcome={SIGN_WELCOME} />
            </Card>
          ) : (
            <SignWizard />
          )}

          <Card title="ทำไมถึงเซ็นไม่ได้" headingLevel={2}>
            <LayeredContent markdown={getOpsMarkdown('sign', 'refusals')} />
          </Card>
        </div>
      </RequireRole>
    </section>
  );
}
