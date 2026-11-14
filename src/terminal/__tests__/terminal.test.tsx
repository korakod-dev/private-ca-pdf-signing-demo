// Terminal core: dispatcher (headless, scripted IO) and TerminalView (prompt engine, secret masking, history, links).
// API mocked with vi.mock (ls uses demoApi.workstation()).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { TerminalCommand, TerminalIO, TerminalLineKind } from '../../contracts/terminal';
import { TID } from '../../contracts/testids';
import { fail, ok } from '../../store/__tests__/fakes';

const workstation = vi.hoisted(() => vi.fn());
vi.mock('../../api', () => ({ configureApi: vi.fn(), api: {}, demoApi: { workstation } }));

import { PromptAborted, runLine } from '../core/dispatch';
import { TerminalView, type TerminalHandle } from '../core/TerminalView';

const WS = {
  documents: [
    { path: '~/Documents/memo-130-unsigned.pdf', document_id: 'D12', sha256: 'de00' + '0'.repeat(60) },
    { path: '~/Documents/memo-130-s1.signed.pdf', document_id: 'D12-s1', sha256: 'de00' + '1'.repeat(60) },
  ],
  private_ca: [{ path: '~/.private-ca/somchai.key', kind: 'private_key' }],
};

/** Scripted IO: records output and answers prompts from a queue. */
function fakeIo(answers: string[] = []) {
  const out: { text: string; kind: TerminalLineKind }[] = [];
  const asked: { label: string; secret: boolean }[] = [];
  let cleared = 0;
  const io: TerminalIO = {
    print: (text, kind = 'out') => void out.push({ text, kind }),
    prompt: async (label, opts) => {
      asked.push({ label, secret: opts?.secret === true });
      return answers.shift() ?? '';
    },
    clear: () => void cleared++,
    link: (label, to) => void out.push({ text: `${label} -> ${to}`, kind: 'info' }),
  };
  return { io, out, asked, cleared: () => cleared, text: () => out.map((o) => o.text).join('\n') };
}

beforeEach(() => {
  workstation.mockReset();
  workstation.mockResolvedValue(ok(WS));
});

describe('runLine (headless)', () => {
  it('unknown commands answer "command not found (demo)" with exit 127', async () => {
    const f = fakeIo();
    expect(await runLine('rm -rf /', { io: f.io, user: null, commands: [] })).toBe(127);
    expect(f.out).toEqual([{ text: 'rm: command not found (demo)', kind: 'err' }]);
  });

  it('an empty line does nothing', async () => {
    const f = fakeIo();
    expect(await runLine('   ', { io: f.io, user: null, commands: [] })).toBe(0);
    expect(f.out).toEqual([]);
  });

  it('reports unterminated quotes instead of throwing', async () => {
    const f = fakeIo();
    expect(await runLine('ls "x', { io: f.io, user: null, commands: [] })).toBe(2);
    expect(f.text()).toMatch(/parse error: unterminated double quote/);
  });

  it('help lists built-ins and registered commands with summaries', async () => {
    const f = fakeIo();
    const tool: TerminalCommand = { name: 'pki-tool', summary: 'ขอใบรับรอง', run: async () => 0 };
    await runLine('help', { io: f.io, user: null, commands: [tool] });
    const text = f.text();
    for (const name of ['help', 'clear', 'ls', 'pki-tool']) expect(text).toContain(name);
    expect(text).toContain('ขอใบรับรอง');
  });

  it('clear clears the screen', async () => {
    const f = fakeIo();
    await runLine('clear', { io: f.io, user: null, commands: [] });
    expect(f.cleared()).toBe(1);
  });

  it('ls (no argument) lists every directory of the simulated workstation', async () => {
    const f = fakeIo();
    expect(await runLine('ls', { io: f.io, user: null, commands: [] })).toBe(0);
    expect(f.text()).toContain('~/Documents:');
    expect(f.text()).toContain('memo-130-unsigned.pdf');
    expect(f.text()).toContain('~/.private-ca:');
    expect(f.text()).toContain('somchai.key');
  });

  it('ls <dir> lists one directory (trailing slash allowed) and reports a missing one', async () => {
    const f = fakeIo();
    await runLine('ls ~/Documents/', { io: f.io, user: null, commands: [] });
    expect(f.out.map((o) => o.text)).toEqual(['memo-130-unsigned.pdf', 'memo-130-s1.signed.pdf']);
    const g = fakeIo();
    expect(await runLine('ls ~/nowhere', { io: g.io, user: null, commands: [] })).toBe(2);
    expect(g.text()).toContain('No such file or directory (demo)');
  });

  it('ls prints the API error when the workstation call fails', async () => {
    workstation.mockResolvedValue(fail(500, 'down'));
    const f = fakeIo();
    expect(await runLine('ls', { io: f.io, user: null, commands: [] })).toBe(2);
    expect(f.text()).toBe('ls: down');
  });

  it('passes parsed args and the acting user to a registered command, with boolean flags honoured', async () => {
    let seen: Parameters<TerminalCommand['run']>[0] | undefined;
    const cmd: TerminalCommand = { name: 'pdfsign', summary: '', run: async (ctx) => ((seen = ctx), 0) };
    const user = { id: 'u-somchai', display_name: 'สมชาย ใจดี', email: 'somchai@lab.korakod.dev', role: 'signer' } as const;
    const f = fakeIo();
    await runLine('pdfsign sign --certify ~/Documents/x.pdf --field "approver-1"', { io: f.io, user, commands: [cmd] });
    expect(seen?.user).toBe(user);
    expect(seen?.args.positional).toEqual(['sign', '~/Documents/x.pdf']);
    expect(seen?.args.flags).toEqual({ certify: true, field: 'approver-1' });
  });

  it('a command that throws is reported as an internal error, not propagated', async () => {
    const cmd: TerminalCommand = { name: 'boom', summary: '', run: async () => Promise.reject(new Error('secret detail')) };
    const f = fakeIo();
    expect(await runLine('boom', { io: f.io, user: null, commands: [cmd] })).toBe(1);
    expect(f.text()).toBe('boom: internal error (demo)'); // no raw error text leaked
  });

  it('a prompt aborted with Ctrl+C ends the command with exit 130', async () => {
    const cmd: TerminalCommand = { name: 'ask', summary: '', run: async ({ io }) => (await io.prompt('x'), 0) };
    const f = fakeIo();
    f.io.prompt = () => Promise.reject(new PromptAborted());
    expect(await runLine('ask', { io: f.io, user: null, commands: [cmd] })).toBe(130);
    expect(f.text()).toBe('^C');
  });
});

describe('TerminalView', () => {
  const ask: TerminalCommand = {
    name: 'ask',
    summary: 'test',
    async run({ io }) {
      const name = await io.prompt('ชื่อ:');
      const secret = await io.prompt('รหัสผ่าน:', { secret: true });
      io.print(`hello ${name} len=${secret.length}`, 'ok');
      io.link('เปิดผลตรวจ', '/verify/job-0001');
      return 0;
    },
  };

  const renderTerminal = () =>
    render(
      <MemoryRouter>
        <TerminalView commands={[ask]} user={null} />
      </MemoryRouter>,
    );
  const output = () => screen.getByTestId(TID.terminal.output);
  const input = () => screen.getByTestId(TID.terminal.input) as HTMLInputElement;

  it('is an accessible log region with a labelled input', () => {
    renderTerminal();
    expect(screen.getByRole('log', { name: /เทอร์มินัล/ })).toBe(output());
    expect(screen.getByLabelText('พิมพ์คำสั่ง')).toBe(input());
    expect(output()).toHaveTextContent('พิมพ์ help');
  });

  it('runs a command and echoes the typed line', async () => {
    const user = userEvent.setup();
    renderTerminal();
    await user.type(input(), 'help{Enter}');
    await waitFor(() => expect(output()).toHaveTextContent('$ help'));
    expect(output()).toHaveTextContent('ask');
    expect(input()).toHaveValue('');
  });

  it('unknown command text', async () => {
    const user = userEvent.setup();
    renderTerminal();
    await user.type(input(), 'sudo make me a certificate{Enter}');
    expect(await screen.findByText('sudo: command not found (demo)')).toBeInTheDocument();
  });

  it('clear empties the output', async () => {
    const user = userEvent.setup();
    renderTerminal();
    await user.type(input(), 'help{Enter}');
    await screen.findByText(/ล้างหน้าจอ/);
    await user.type(input(), 'clear{Enter}');
    await waitFor(() => expect(output()).not.toHaveTextContent('ล้างหน้าจอ'));
    expect(output()).not.toHaveTextContent('$ help');
  });

  it('answers a question: the answer is echoed, then the next question is asked', async () => {
    const user = userEvent.setup();
    renderTerminal();
    await user.type(input(), 'ask{Enter}');
    await waitFor(() => expect(screen.getByLabelText('ชื่อ:')).toBe(input()));
    expect(input()).toHaveAttribute('type', 'text');
    await user.type(input(), 'สมชาย{Enter}');
    await waitFor(() => expect(screen.getByLabelText('รหัสผ่าน:')).toBe(input()));
    expect(output()).toHaveTextContent('ชื่อ: สมชาย');
  });

  it('a SECRET answer is masked in the field and never echoed or kept', async () => {
    const user = userEvent.setup();
    renderTerminal();
    await user.type(input(), 'ask{Enter}');
    await waitFor(() => expect(screen.getByLabelText('ชื่อ:')).toBe(input()));
    await user.type(input(), 'x{Enter}');
    await waitFor(() => expect(screen.getByLabelText('รหัสผ่าน:')).toBe(input()));
    expect(input()).toHaveAttribute('type', 'password'); // masked while typing
    await user.type(input(), 'S3cretPassphrase!{Enter}');
    await screen.findByText(/hello x len=17/); // the command did receive the full secret
    // Nowhere in the page text, not in the output, not in the field.
    expect(document.body.textContent).not.toContain('S3cretPassphrase');
    expect(input()).toHaveValue('');
    // The question itself is echoed without any answer text.
    expect(within(output()).getByText('รหัสผ่าน:')).toBeInTheDocument();
    // ArrowUp must not bring the secret back (history holds commands only).
    await user.type(input(), '{ArrowUp}');
    expect(input()).toHaveValue('ask');
    expect(input()).not.toHaveValue(expect.stringContaining('S3cret'));
  });

  it('renders io.link as an in-app link', async () => {
    const user = userEvent.setup();
    renderTerminal();
    await user.type(input(), 'ask{Enter}');
    await waitFor(() => expect(screen.getByLabelText('ชื่อ:')).toBe(input()));
    await user.type(input(), 'a{Enter}');
    await waitFor(() => expect(screen.getByLabelText('รหัสผ่าน:')).toBe(input()));
    await user.type(input(), 'b{Enter}');
    expect(await screen.findByRole('link', { name: 'เปิดผลตรวจ' })).toHaveAttribute('href', '/verify/job-0001');
  });

  it('history: ArrowUp / ArrowDown walk the commands and restore the draft', async () => {
    const user = userEvent.setup();
    renderTerminal();
    await user.type(input(), 'help{Enter}');
    await waitFor(() => expect(input()).toBeEnabled());
    await user.type(input(), 'foo{Enter}');
    await waitFor(() => expect(input()).toBeEnabled());
    await user.type(input(), 'dra');
    await user.keyboard('{ArrowUp}');
    expect(input()).toHaveValue('foo');
    await user.keyboard('{ArrowUp}');
    expect(input()).toHaveValue('help');
    await user.keyboard('{ArrowUp}'); // stays at the oldest
    expect(input()).toHaveValue('help');
    await user.keyboard('{ArrowDown}');
    expect(input()).toHaveValue('foo');
    await user.keyboard('{ArrowDown}');
    expect(input()).toHaveValue('dra'); // draft restored
  });

  it('Ctrl+C at a question cancels the command', async () => {
    const user = userEvent.setup();
    renderTerminal();
    await user.type(input(), 'ask{Enter}');
    await waitFor(() => expect(screen.getByLabelText('ชื่อ:')).toBe(input()));
    await user.keyboard('{Control>}c{/Control}');
    expect(await screen.findByText('^C')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('พิมพ์คำสั่ง')).toBe(input()));
  });

  it('ignores a second command line while the first one is still running', async () => {
    let release: () => void = () => {};
    const slow: TerminalCommand = {
      name: 'slow',
      summary: '',
      run: ({ io }) =>
        new Promise<number>((resolve) => {
          release = () => (io.print('slow done'), resolve(0));
        }),
    };
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <TerminalView commands={[slow]} user={null} />
      </MemoryRouter>,
    );
    await user.type(input(), 'slow{Enter}');
    await waitFor(() => expect(input()).toBeDisabled()); // typing is blocked while it runs
    release();
    await screen.findByText('slow done');
    await waitFor(() => expect(input()).toBeEnabled());
    await waitFor(() => expect(input()).toHaveFocus()); // focus comes back on its own
  });

  describe('handle (host-driven commands, e.g. the "รัน pki-tool init" button)', () => {
    it('runCommand runs the line like typing it: echo, question, masked secret', async () => {
      const handle = createRef<TerminalHandle>();
      render(
        <MemoryRouter>
          <TerminalView commands={[ask]} user={null} handleRef={handle} />
        </MemoryRouter>,
      );
      act(() => handle.current!.runCommand('ask'));
      await waitFor(() => expect(output()).toHaveTextContent('$ ask'));
      expect(await screen.findByLabelText('ชื่อ:')).toBe(input());
    });

    it('is ignored while a question is waiting (it must not answer the question), and focuses the field', async () => {
      const handle = createRef<TerminalHandle>();
      render(
        <MemoryRouter>
          <TerminalView commands={[ask]} user={null} handleRef={handle} />
        </MemoryRouter>,
      );
      act(() => handle.current!.runCommand('ask'));
      await screen.findByLabelText('ชื่อ:');
      act(() => handle.current!.runCommand('help'));
      expect(output()).not.toHaveTextContent('$ help');
      expect(output()).not.toHaveTextContent('ชื่อ: help');
      expect(input()).toHaveFocus();
    });
  });
});
