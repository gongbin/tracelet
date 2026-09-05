/// <reference lib="webworker" />
import { autoroute, registerProjectLibrary, type Board, type RuleSet, type AutorouteOptions, type Project } from '@tracelet/kernel';

export interface AutorouteRequest { board: Board; rules: RuleSet; library?: Project['library']; opts?: Omit<AutorouteOptions, 'onProgress'> }
export type AutorouteMessage = { type: 'progress'; done: number; total: number; net: string } | { type: 'done'; result: ReturnType<typeof autoroute> } | { type: 'error'; message: string };

self.onmessage = (e: MessageEvent<AutorouteRequest>) => {
  const { board, rules, library, opts } = e.data;
  try {
    registerProjectLibrary(library);
    const result = autoroute(board, rules, { ...(opts ?? {}), onProgress: (done, total, net) => (self as unknown as Worker).postMessage({ type: 'progress', done, total, net } satisfies AutorouteMessage) });
    (self as unknown as Worker).postMessage({ type: 'done', result } satisfies AutorouteMessage);
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'error', message: (err as Error).message } satisfies AutorouteMessage);
  }
};
