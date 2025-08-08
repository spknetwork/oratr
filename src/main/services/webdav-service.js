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

    // Directory and file handlers (read-only) + permissive Basic auth
    server.beforeRequest(async (ctx, next) => {
      const method = ctx.request.method || '';
      // If no Authorization provided, challenge with Basic to satisfy DAV clients
      const authHeader = (ctx.request && ctx.request.headers && (ctx.request.headers.authorization || ctx.request.headers.Authorization)) || null;
      if (!authHeader && (method === 'PROPFIND' || method === 'HEAD' || method === 'GET')) {
        ctx.setCode(webdav.HTTPCodes.Unauthorized);
        ctx.response.setHeader('WWW-Authenticate', 'Basic realm="Oratr", charset="UTF-8"');
        ctx.response.setHeader('DAV', '1,2');
        ctx.response.setHeader('MS-Author-Via', 'DAV');
        return ctx.end();
      }
      // Handle PROPFIND for directory listings
      if (method === 'PROPFIND' || method === 'HEAD') {
        try {
          const parts = ctx.requested.path.paths; // ['', 'username', '...'] already split by lib
          if (parts.length === 0) {
            // Root: return empty collection
          const xml = buildMultiStatus('/', [], true);
            ctx.setCode(webdav.HTTPCodes.MultiStatus);
          ctx.response.setHeader('Content-Type', 'text/xml; charset="utf-8"');
          ctx.response.setHeader('DAV', '1,2');
          ctx.response.setHeader('MS-Author-Via', 'DAV');
          ctx.response.setHeader('Content-Length', Buffer.byteLength(xml, 'utf8'));
            if (method !== 'HEAD') ctx.response.write(xml);
            return ctx.end();
          }
          const username = parts[0];
          const subPath = parts.slice(1).join('/');
          // Normalize: ensure directory hrefs end with slash, regardless of client input
          // Fetch directory JSON from Honeygraph
          const apiUrl = subPath
            ? `https://honeygraph.dlux.io/fs/${encodeURIComponent(username)}/${encodeURI(subPath)}`
            : `https://honeygraph.dlux.io/fs/${encodeURIComponent(username)}/`;
          const { data } = await axios.get(apiUrl, { headers: { Accept: 'application/json' } });
          const children = Array.isArray(data.contents) ? data.contents : [];
          // Build WebDAV multi-status XML
          const hrefBase = '/' + [username].concat(subPath ? [subPath] : []).join('/') + '/';
          const xml = buildMultiStatus(hrefBase, children, true);
          ctx.setCode(webdav.HTTPCodes.MultiStatus);
          ctx.response.setHeader('Content-Type', 'text/xml; charset="utf-8"');
          ctx.response.setHeader('DAV', '1,2');
          ctx.response.setHeader('MS-Author-Via', 'DAV');
          ctx.response.setHeader('Content-Length', Buffer.byteLength(xml, 'utf8'));
          if (method !== 'HEAD') ctx.response.write(xml);
          return ctx.end();
        } catch (e) {
          ctx.setCode(webdav.HTTPCodes.NotFound);
          return ctx.end();
        }
      }

      // Only intercept GET for file proxying
      if (method === 'GET' && !ctx.requested.path.isRoot()) {
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
      this.httpServer = http.createServer(async (req, res) => {
        try {
          // OPTIONS for DAV capability probing
          if (req.method === 'OPTIONS') {
            res.statusCode = 200;
            res.setHeader('DAV', '1,2');
            res.setHeader('MS-Author-Via', 'DAV');
            res.setHeader('Allow', 'OPTIONS, PROPFIND, GET, HEAD');
            res.setHeader('Accept-Ranges', 'bytes');
            res.setHeader('Content-Length', '0');
            res.end();
            return;
          }

          // Simple GET redirect handler before WebDAV processing
          if (req.method === 'GET') {
            const parsed = new URL(req.url, 'http://127.0.0.1');
            const parts = parsed.pathname.split('/').filter(Boolean);
            // Directory listing in browser
            if (parts.length >= 1) {
              const username = parts[0];
              const subPath = parts.slice(1).join('/');
              if (!username) {
                res.statusCode = 200;
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                res.end('<h1>Oratr WebDAV</h1><p>Provide /:username or mount via WebDAV client.</p>');
                return;
              }

              // If no file component, or URL ends with '/', treat as directory and render HTML
              const isDirRequest = parts.length === 1 || parsed.pathname.endsWith('/');
              if (isDirRequest) {
                const apiUrl = subPath
                  ? `https://honeygraph.dlux.io/fs/${encodeURIComponent(username)}/${encodeURI(subPath)}`
                  : `https://honeygraph.dlux.io/fs/${encodeURIComponent(username)}/`;
                try {
                  const { data } = await axios.get(apiUrl, { headers: { Accept: 'application/json' } });
                  if (data && data.type === 'directory' && Array.isArray(data.contents)) {
                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'text/html; charset=utf-8');
                    const title = `/${username}/${subPath || ''}`;
                    const list = data.contents
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map(item => {
                        const dir = item.type === 'directory';
                        const display = dir ? item.name : combineName(item.name, item.extension);
                        const hrefName = dir ? item.name : combineName(item.name, item.extension);
                        const href = '/' + [username].concat(subPath ? [subPath] : []).concat([encodeURIComponent(hrefName) + (dir ? '/' : '')]).join('/');
                        const icon = dir ? '📁' : '📄';
                        const size = dir ? '' : ` (${item.size || 0} bytes)`;
                        return `<li>${icon} <a href="${href}">${escapeHtml(display)}</a>${size}</li>`;
                      })
                      .join('\n');
                    const upHref = parts.length > 1 ? '/' + [username].concat(parts.slice(1, -1)).join('/') + '/' : '/';
                    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>
                      <h1>Index of ${escapeHtml(title)}</h1>
                      <p><a href="${upHref}">⬆ Up</a></p>
                      <ul>${list}</ul>
                    </body></html>`;
                    res.end(html);
                    return;
                  }
                } catch (e) {
                  // fall through to file handling/404
                }
              }

              // If no trailing slash but target is a directory, redirect to slash-suffixed path for clients that drop it
              if (username && subPath && !parsed.pathname.endsWith('/')) {
                try {
                  const probeUrl = `https://honeygraph.dlux.io/fs/${encodeURIComponent(username)}/${encodeURI(subPath)}/`;
                  const { data: probe } = await axios.get(probeUrl, { headers: { Accept: 'application/json' } });
                  if (probe && probe.type === 'directory') {
                    res.statusCode = 301;
                    res.setHeader('Location', `/${username}/${subPath}/`);
                    res.end();
                    return;
                  }
                } catch (_) {
                  // ignore and fall through to file handling
                }
              }

              // File request: stream and preserve filename; map trailing '.' to no extension on upstream
              if (username && subPath) {
                const segs = subPath.split('/');
                const last = segs.pop() || '';
                const upstreamLast = last.endsWith('.') ? last.slice(0, -1) : last;
                const target = `https://honeygraph.dlux.io/fs/${encodeURIComponent(username)}/${encodeURI(segs.concat([upstreamLast]).join('/'))}`;
                const rawName = decodeURIComponent(last || 'download');
                const safeName = rawName.replace(/[^A-Za-z0-9._ -]/g, '_');
                try {
                  const upstream = await axios.get(target, { responseType: 'stream', maxRedirects: 5 });
                  res.statusCode = upstream.status;
                  const ct = upstream.headers['content-type'] || 'application/octet-stream';
                  const cl = upstream.headers['content-length'];
                  res.setHeader('Content-Type', ct);
                  if (cl) res.setHeader('Content-Length', cl);
                  res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
                  upstream.data.pipe(res);
                } catch (e) {
                  res.statusCode = 404;
                  res.end('Not Found');
                }
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

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtml(s) {
  return xmlEscape(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Build WebDAV multistatus for a directory listing
function buildMultiStatus(hrefBase, items, includeSelf) {
  const responses = [];
  if (includeSelf) {
    responses.push(responseXml(hrefBase, true));
  }
  for (const item of items) {
    const isDir = item.type === 'directory';
    const name = item.name || 'unknown';
    const href = hrefBase + encodeURIComponent(name) + (isDir ? '/' : '');
    const size = isDir ? 0 : item.size || 0;
    responses.push(responseXml(href, isDir, size, item.mimeType || 'application/octet-stream'));
  }
  return `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
${responses.join('\n')}
</d:multistatus>`;
}

function responseXml(href, isCollection, size = 0, contentType = 'application/octet-stream') {
  return `<d:response>
  <d:href>${xmlEscape(href)}</d:href>
  <d:propstat>
    <d:prop>
      <d:displayname>${xmlEscape(decodeURIComponent(href.split('/').filter(Boolean).pop() || ''))}</d:displayname>
      ${isCollection ? '<d:resourcetype><d:collection/></d:resourcetype>' : '<d:resourcetype/>'}
      ${!isCollection ? `<d:getcontentlength>${size}</d:getcontentlength>
      <d:getcontenttype>${xmlEscape(contentType)}</d:getcontenttype>` : ''}
    </d:prop>
    <d:status>HTTP/1.1 200 OK</d:status>
  </d:propstat>
</d:response>`;
}

function combineName(name, extension) {
  return extension ? `${name}.${extension}` : `${name}`;
}

module.exports = WebDavService;


