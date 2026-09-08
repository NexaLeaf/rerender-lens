/**
 * A tiny local relay (`npx rerender-lens panel`): serves the panel and forwards messages between
 * app pages and panel pages over Server-Sent Events + POST, so any app (Next.js, Webpack, a
 * production-like build) gets the panel without the extension and without a same-origin channel.
 *
 *   GET  /                      redirect to /panel.html?relay=<this server>
 *   GET  /panel.(html|js|css)   the panel page
 *   GET  /events?role=app       SSE: commands from panels
 *   GET  /events?role=panel     SSE: hello / report / clear from apps, replies to commands
 *   POST /message               one message or an array; `{ __rerenderLens }` and replies go to
 *                               panels, `{ __rerenderLensCmd }` goes to apps
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

export interface RelayServer {
  server: Server;
  /** `http://127.0.0.1:4141` once listening. */
  url: string;
  port: number;
  close(): Promise<void>;
  /** Connected app and panel streams. */
  counts(): { apps: number; panels: number };
}

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
  const apps = new Set<ServerResponse>();
  const panels = new Set<ServerResponse>();
  let url = '';

  const send = (targets: Set<ServerResponse>, message: unknown): void => {
    const line = `data: ${JSON.stringify(message)}\n\n`;
    for (const res of targets) {
      try {
        res.write(line);
      } catch {
        targets.delete(res);
      }
    }
  };

  const route = (message: unknown): void => {
    if (!message || typeof message !== 'object') return;
    const m = message as Record<string, unknown>;
    if (m.__rerenderLensCmd === true) send(apps, m);
    else if (m.__rerenderLens === true || m.__rerenderLensReply === true) send(panels, m);
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
      const role = u.searchParams.get('role') === 'app' ? apps : panels;
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Connection', 'keep-alive');
      res.write(': connected\n\n');
      role.add(res);
      const ping = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch {
          /* closed */
        }
      }, keepAliveMs);
      req.on('close', () => {
        clearInterval(ping);
        role.delete(res);
      });
      // Panels learn the app count as soon as their stream is open (that first message is also how a
      // panel knows it is safe to send commands: replies only reach panels that are already connected),
      // and again whenever an app comes or goes, so they show "disconnected" instead of waiting.
      const count = (): unknown => ({ __rerenderLens: true, version: 2, type: 'relay', payload: { apps: apps.size } });
      if (role === apps) {
        send(panels, count());
        req.on('close', () => send(panels, count()));
      } else {
        send(new Set([res]), count());
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
        for (const m of Array.isArray(parsed) ? parsed : [parsed]) route(m);
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
      res.end(JSON.stringify({ ok: true, apps: apps.size, panels: panels.size }));
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
        close: () =>
          new Promise<void>((done) => {
            for (const res of [...apps, ...panels]) res.end();
            apps.clear();
            panels.clear();
            server.close(() => done());
          }),
      });
    });
  });
}
