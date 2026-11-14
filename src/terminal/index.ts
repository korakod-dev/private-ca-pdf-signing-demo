// Public surface of the simulated terminal (pages import from '../terminal').
export { TerminalView, TERMINAL_WELCOME, type TerminalViewProps, type TerminalHandle } from './core/TerminalView';
export { parseArgs, tokenize, ParseError, type ParseOptions } from './core/parseArgs';
export { runLine, builtinCommands, PromptAborted, BOOLEAN_FLAGS, EXIT_NOT_FOUND } from './core/dispatch';
export { useTerminal, type TerminalController, type TerminalLine, type PendingPrompt } from './core/useTerminal';
export { COMMANDS } from './registry';
