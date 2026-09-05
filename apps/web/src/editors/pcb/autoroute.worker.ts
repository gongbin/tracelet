/// <reference lib="webworker" />
import { autoroute, optimizePlacement, registerProjectLibrary, type Board, type RuleSet, type AutorouteOptions, type PlacementOptions, type PlacementResult, type Project } from '@tracelet/kernel';

export interface AutorouteRequest { kind?: 'autoroute' | 'placement'; board: Board; rules: RuleSet; library?: Project['library']; opts?: Omit<AutorouteOptions, 'onProgress'>; placementOpts?: Omit<PlacementOptions, 'onProgress'> }
export type AutorouteMessage = { type: 'progress'; done: number; total: number; net: string } | { type: 'stage'; stage: string } | { type: 'done'; result: ReturnType<typeof autoroute> } | { type: 'placement'; result: PlacementResult } | { type: 'error'; message: string };

self.onmessage = (e: MessageEvent<AutorouteRequest>) => {
  const { kind, board, rules, library, opts, placementOpts } = e.data;
  const post = (m: AutorouteMessage) => (self as unknown as Worker).postMessage(m);
  try {
    registerProjectLibrary(library);
    if (kind === 'placement') {
      const result = optimizePlacement(board, rules, { ...(placementOpts ?? {}), onProgress: (stage) => post({ type: 'stage', stage }) });
      post({ type: 'placement', result });
      return;
    }
    const result = autoroute(board, rules, { ...(opts ?? {}), onProgress: (done, total, net) => post({ type: 'progress', done, total, net }) });
    post({ type: 'done', result });
  } catch (err) {
    post({ type: 'error', message: (err as Error).message });
  }
};
