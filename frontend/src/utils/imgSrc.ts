const isElectronFileProtocol =
  typeof window !== 'undefined' && window.location?.protocol === 'file:';

/**
 * 将后端返回的相对路径（如 /api/files/:id）在 Electron 中补齐为绝对地址；
 * 在浏览器中保持原样（通过 Vite /api 代理到后端）。
 */
export function resolveServe(url?: string | null): string {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (!isElectronFileProtocol) return url;
  if (url.startsWith('/')) return `http://127.0.0.1:18000${url}`;
  return `http://127.0.0.1:18000/${url}`;
}

/**
 * CharacterImage 的图片地址解析：
 * - 如果 url 是绝对 http(s) 链接则直接返回
 * - 如果是相对 /api/files/:id 则在 Electron 下补齐后端地址
 */
export function characterImageSrc(img: { url?: string }): string {
  return resolveServe(img?.url);
}