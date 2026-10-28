// Types for connectionDecision.js, so the property test (TypeScript) imports the same file the page does.
export function onClose(code: number, sessionStatus: number | null): 'signedOut' | 'reconnect';
export function needsSessionCheck(code: number): boolean;
