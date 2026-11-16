import { net, protocol } from 'electron';
import { join, normalize, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The renderer is served from app://studio/… — no localhost HTTP server (IDE_DESIGN.md §3). */
export const APP_SCHEME = 'app';
export const APP_HOST = 'studio';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/** Must run before app 'ready'. */
export function registerAppSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
}

/** Resolve a request path inside rootDir, refusing anything that escapes it. Exported for tests. */
export function resolveInside(rootDir: string, requestPath: string): string | null {
  const decoded = decodeURIComponent(requestPath);
  const rel = normalize(decoded === '/' || decoded === '' ? 'index.html' : decoded.replace(/^\/+/, ''));
  const full = join(rootDir, rel);
  const back = relative(rootDir, full);
  if (back.startsWith('..') || isAbsolute(back)) return null;
  return full;
}

/** Must run after app 'ready'. */
export function serveRendererFrom(rootDir: string): void {
  protocol.handle(APP_SCHEME, (request) => {
    const url = new URL(request.url);
    if (url.host !== APP_HOST) return new Response('Not found', { status: 404 });
    const file = resolveInside(rootDir, url.pathname);
    if (!file) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
}
