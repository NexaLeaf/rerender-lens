/**
 * A tiny local relay (`npx rerender-lens panel`): serves the panel and forwards messages between
 * app pages and panel pages over Server-Sent Events + POST, so any app (Next.js, Webpack, a
 * production-like build) gets the panel without the extension and without a same-origin channel.
 *
 *   GET  /                      redirect to /panel.html?relay=<this server>
 *   GET  /panel.(html|js|css)   the panel page
 *   GET  /events?role=app       SSE: commands from panels (first message: this app's id)
 *   GET  /events?role=panel     SSE: hello / report / clear from apps, replies to commands
 *   POST /message               one message or an array; `{ __rerenderLens }` and replies go to
 *                               panels, `{ __rerenderLensCmd }` goes to apps
 *
 * Several apps can share one relay. Each app connection gets an id; the relay tells the app its id,
 * stamps `app` on everything that app sends, and sends panels the roster whenever it changes. A
 * command carrying `app` goes to that one app, a command without it goes to all of them, so a panel
 * or a library that knows nothing about ids behaves exactly as before.
 *
 * Dependency-free (node:http). CORS is open: the relay is a local dev tool, bind it to 127.0.0.1.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface RelayOptions {
  port?: number;
  host?: string;
  /** Directory with panel.html/js/css; found automatically in the package. */
  panelDir?: string | null;
  /** Milliseconds between SSE keep-alive comments. Default 15000. */
  keepAliveMs?: number;
}

/** One connected app page. `label` is what the panel's app chooser shows. */
export interface RelayApp {
  id: string;
  label: string;
}

export interface RelayServer {
  server: Server;
  /** `http://127.0.0.1:4141` once listening. */
  url: string;
  port: number;
  close(): Promise<void>;
  /** Connected app and panel streams. */
  counts(): { apps: number; panels: number };
  /** The connected apps, in connection order. */
  appList(): RelayApp[];
}

/** Same marker and protocol the library and the panel use (`src/devtools.ts`); kept literal so the relay stays dependency-free. */
const MARKER = '__rerenderLens';
const PROTOCOL = 2;

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

export function findPanelDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const dir of [join(here, '..', 'panel'), join(here, '..', 'extension'), join(here, '..', '..', 'extension')]) {
    if (existsSync(join(dir, 'panel.html')) && existsSync(join(dir, 'panel.js'))) return dir;
  }
  return null;
}

const cors = (res: ServerResponse): void => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

function readBody(req: IncomingMessage, limit = 8 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createRelayServer(options: RelayOptions = {}): Promise<RelayServer> {
  const host = options.host ?? '127.0.0.1';
  const panelDir = options.panelDir === undefined ? findPanelDir() : options.panelDir;
  const keepAliveMs = options.keepAliveMs ?? 15_000;
  const apps = new Map<ServerResponse, RelayApp>();
  const panels = new Set<ServerResponse>();
  let url = '';
  let nextAppId = 1;

  const line = (message: unknown): string => `data: ${JSON.stringify(message)}\n\n`;
  const sendTo = (res: ServerResponse, message: unknown): void => {
    try {
      res.write(line(message));
    } catch {
      apps.delete(res);
      panels.delete(res);
    }
  };
  const send = (targets: Iterable<ServerResponse>, message: unknown): void => {
    const text = line(message);
    for (const res of [...targets]) {
      try {
        res.write(text);
      } catch {
        apps.delete(res);
        panels.delete(res);
      }
    }
  };

  const appList = (): RelayApp[] => [...apps.values()];
  const roster = (): unknown => ({ [MARKER]: true, version: PROTOCOL, type: 'relay', payload: { apps: apps.size, list: appList() } });
  const streamOf = (id: string): ServerResponse | null => {
    for (const [res, app] of apps) if (app.id === id) return res;
    return null;
  };

  const route = (message: unknown, from?: RelayApp): void => {
    if (!message || typeof message !== 'object') return;
    const m = message as Record<string, unknown>;
    if (m.__rerenderLensCmd === true) {
      // A command names its app when the panel is watching one of several; otherwise every app answers.
      const target = typeof m.app === 'string' ? streamOf(m.app) : null;
      if (target) sendTo(target, m);
      else send(apps.keys(), m);
    } else if (m.__rerenderLens === true || m.__rerenderLensReply === true) {
      send(panels, from ? { ...m, app: from.id } : m);
    }
  };

  const server = createServer(async (req, res) => {
    cors(res);
    const u = new URL(req.url || '/', 'http://relay');
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (u.pathname === '/' && req.method === 'GET') {
      res.statusCode = 302;
      res.setHeader('Location', `/panel.html?relay=${encodeURIComponent(url)}`);
      res.end();
      return;
    }
    if (u.pathname === '/events' && req.method === 'GET') {
      const isApp = u.searchParams.get('role') === 'app';
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Connection', 'keep-alive');
      res.write(': connected\n\n');
      const app: RelayApp | null = isApp ? { id: `a${nextAppId++}`, label: (u.searchParams.get('label') || req.headers.origin || '').slice(0, 120) || `app ${nextAppId - 1}` } : null;
      if (app) apps.set(res, app);
      else panels.add(res);
      const ping = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch {
          /* closed */
        }
      }, keepAliveMs);
      req.on('close', () => {
        clearInterval(ping);
        apps.delete(res);
        panels.delete(res);
      });
      // Panels learn the roster as soon as their stream is open (that first message is also how a
      // panel knows it is safe to send commands: replies only reach panels that are already connected),
      // and again whenever an app comes or goes, so they show "disconnected" instead of waiting.
      if (app) {
        sendTo(res, { __rerenderLensRelay: true, version: PROTOCOL, app: app.id }); // the app stamps this on what it sends
        send(panels, roster());
        req.on('close', () => send(panels, roster()));
      } else {
        sendTo(res, roster());
      }
      return;
    }
    if (u.pathname === '/favicon.ico') {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (u.pathname === '/message' && req.method === 'POST') {
      try {
        const parsed = JSON.parse((await readBody(req)) || 'null') as unknown;
        const sender = u.searchParams.get('app');
        const from = sender ? (appList().find((a) => a.id === sender) ?? undefined) : undefined;
        for (const m of Array.isArray(parsed) ? parsed : [parsed]) route(m, from);
        res.statusCode = 204;
        res.end();
      } catch (e) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'text/plain');
        res.end(String((e as Error).message || e));
      }
      return;
    }
    if (u.pathname === '/status' && req.method === 'GET') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, apps: apps.size, panels: panels.size, list: appList() }));
      return;
    }
    const file = u.pathname.replace(/^\//, '');
    if (/^panel\.(html|js|css)$/.test(file) && req.method === 'GET') {
      if (!panelDir) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/plain');
        res.end('rerender-lens: panel files not found (is the package built?)');
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', MIME[file.slice(file.lastIndexOf('.'))] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      res.end(readFileSync(join(panelDir, file)));
      return;
    }
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain');
    res.end('not found');
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 4141, host, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : options.port ?? 4141;
      url = `http://${host === '0.0.0.0' || host === '::' ? 'localhost' : host}:${port}`;
      resolve({
        server,
        url,
        port,
        counts: () => ({ apps: apps.size, panels: panels.size }),
        appList,
        close: () =>
          new Promise<void>((done) => {
            for (const res of [...apps.keys(), ...panels]) res.end();
            apps.clear();
            panels.clear();
            server.close(() => done());
          }),
      });
    });
  });
}
