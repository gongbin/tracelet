import { expect, it, vi } from 'vitest';
import { normalizeStorageToken, storageBaseUrl } from '../src/store/remoteStorage';
import { RemoteProjectStore } from '../src/store/projectStore';
it('normalizes copied credentials and endpoint URLs', () => {
 expect(normalizeStorageToken(' TRACELET_TOKEN=abc123\n')).toBe('abc123');
 expect(normalizeStorageToken('Bearer abc123')).toBe('abc123');
 expect(storageBaseUrl(' https://tracelet.org/api/health/ ')).toBe('https://tracelet.org');
});
it('sends the normalized token and explains unauthorized responses', async () => {
 const fetcher=vi.fn().mockResolvedValue({ok:false,status:401});vi.stubGlobal('fetch',fetcher);
 try {
  const store=new RemoteProjectStore('https://tracelet.org/api/',' Bearer abc123 ');
  await expect(store.list()).rejects.toThrow('访问令牌缺失或无效');
  expect(fetcher).toHaveBeenCalledWith('https://tracelet.org/api/projects',expect.objectContaining({headers:expect.objectContaining({authorization:'Bearer abc123'})}));
 }finally{vi.unstubAllGlobals();}
});
