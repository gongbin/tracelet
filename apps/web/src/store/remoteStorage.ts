/** Accept a copied token value, Authorization header value, or deployment env line. */
export function normalizeStorageToken(token = ''): string {
  return token.trim().replace(/^TRACELET_TOKEN\s*=\s*/i, '').replace(/^Bearer\s+/i, '').trim();
}
export function storageBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').replace(/\/api(?:\/health)?$/, '');
}
export function storageHttpError(status: number): string {
  return status === 401 ? '访问令牌缺失或无效：请填写服务器的 TRACELET_TOKEN 后重试（只填令牌值）' : `远程存储错误 HTTP ${status}`;
}
