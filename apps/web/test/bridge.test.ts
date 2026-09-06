import { afterEach, expect, it, vi } from 'vitest';
import { command, createDemoProject, serializeProject } from '@tracelet/kernel';
import { useApp } from '../src/store/app';
import { _bridgeInternal, handle } from '../src/store/bridge';

afterEach(() => { _bridgeInternal().setSocket(null); useApp.getState().closeProject(); vi.useRealTimers(); });
it('resynchronizes an immediate undo and subsequent local edits instead of tagging them as agent echoes', () => {
  vi.useFakeTimers();
  useApp.getState().openProjectObject(createDemoProject());
  const ed = useApp.getState().editor!;
  const original = ed.project.name;
  const sent: any[] = [];
  _bridgeInternal().setSocket({ readyState: WebSocket.OPEN, send: (data: string) => sent.push(JSON.parse(data)) } as WebSocket);
  _bridgeInternal().watchEditor();
  const apply = () => handle({ type: 'apply', id: ed.project.id, rev: 1, doc: serializeProject({ ...ed.project, name: 'Agent edit' }, false) });
  apply();
  expect(sent.at(-1).fromAgent).toBe(true);
  handle({ type: 'undo', id: ed.project.id });
  expect(sent.at(-1).fromAgent).toBe(false);
  expect(JSON.parse(sent.at(-1).doc).name).toBe(original);
  apply();
  ed.dispatch(command('Local edit', p => ({ ...p, name: 'Local edit' })));
  vi.advanceTimersByTime(250);
  expect(sent.at(-1).fromAgent).toBe(false);
  expect(JSON.parse(sent.at(-1).doc).name).toBe('Local edit');
});
