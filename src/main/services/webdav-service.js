const { ipcMain } = require('electron');
const { v2: webdav } = require('webdav-server');
const http = require('http');
const axios = require('axios');

class WebDavService {
  constructor(services) {
    this.services = services;
    this.server = null;
    this.httpServer = null;
    this.port = 4819; // default local port
  }

  async start(port) {
    if (this.httpServer) return { running: true, port: this.port };
    if (port) this.port = port;

    // Minimal WebDAV file system that proxies Honeygraph FS
    const server = new webdav.WebDAVServer({
      requireAuthentification: false
    });

    // Directory listing handler (read-only)
    server.beforeRequest(async (ctx, next) => {
      // Only intercept GET/PROPFIND for now; others pass through to default which will 405
      if (ctx.request.method === 'GET' && !ctx.requested.path.isRoot()) {
        try {
          const pathParts = ctx.requested.path.paths;
          // path: /<username>/<optional path>
          const username = pathParts[0];
          const subPath = pathParts.slice(1).join('/');
          if (!username) return next();

          if (subPath) {
            // For files, redirect to Honeygraph path (client will download/stream)
            const url = `https://honeygraph.dlux.io/fs/${encodeURIComponent(username)}/${encodeURI(subPath)}`;
            ctx.setCode(webdav.HTTPCodes.MovedPermanently);
            ctx.response.setHeader('Location', url);
            return ctx.end();
          }
        } catch (e) {
          // Fall through
        }
      }
      return next();
    });

    this.server = server;
    await new Promise((resolve) => {
      this.httpServer = http.createServer((req, res) => {
        try {
          // Simple GET redirect handler before WebDAV processing
          if (req.method === 'GET') {
            const parsed = new URL(req.url, 'http://127.0.0.1');
            const parts = parsed.pathname.split('/').filter(Boolean);
            if (parts.length >= 2) {
              const username = parts[0];
              const subPath = parts.slice(1).join('/');
              if (username && subPath) {
                const target = `https://honeygraph.dlux.io/fs/${encodeURIComponent(username)}/${encodeURI(subPath)}`;
                res.statusCode = 302;
                res.setHeader('Location', target);
                res.end();
                return;
              }
            }
          }
        } catch (e) {
          // fallthrough to webdav
        }
        server.executeRequest(req, res);
      });
      this.httpServer.listen(this.port, '127.0.0.1', resolve);
    });

    this.registerIPC();
    return { running: true, port: this.port };
  }

  async stop() {
    if (this.httpServer) {
      await new Promise((resolve) => this.httpServer.close(resolve));
      this.httpServer = null;
      this.server = null;
    }
    return { running: false };
  }

  registerIPC() {
    if (this._ipcRegistered) return;
    this._ipcRegistered = true;
    ipcMain.handle('webdav:start', async (_e, port) => this.start(port));
    ipcMain.handle('webdav:stop', async () => this.stop());
    ipcMain.handle('webdav:status', async () => ({ running: !!this.httpServer, port: this.port }));
  }
}

module.exports = WebDavService;


