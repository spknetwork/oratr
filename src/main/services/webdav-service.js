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
    this.requireAuth = false;
    this.username = '';
    this.password = '';
  }

  async start(configOrPort) {
    if (this.httpServer) return { running: true, port: this.port };
    // Accept legacy numeric port or full config
    if (typeof configOrPort === 'number') {
      this.port = configOrPort;
    } else if (configOrPort && typeof configOrPort === 'object') {
      this.port = Number(configOrPort.port) || this.port;
      this.requireAuth = Boolean(configOrPort.requireAuth);
      this.username = String(configOrPort.username || '').trim();
      this.password = String(configOrPort.password || '').trim();
    }

    // Minimal WebDAV file system that proxies Honeygraph FS
    const server = new webdav.WebDAVServer({
      requireAuthentification: false
    });

    // Directory and file handlers with optional Basic auth
    server.beforeRequest(async (ctx, next) => {
      const method = ctx.request.method || '';
      // Optional Basic auth
      const authHeader = (ctx.request && ctx.request.headers && (ctx.request.headers.authorization || ctx.request.headers.Authorization)) || null;
      if (this.requireAuth) {
        if (!authHeader) {
          ctx.setCode(webdav.HTTPCodes.Unauthorized);
          ctx.response.setHeader('WWW-Authenticate', 'Basic realm="Oratr", charset="UTF-8"');
          ctx.response.setHeader('DAV', '1,2');
          ctx.response.setHeader('MS-Author-Via', 'DAV');
          return ctx.response.end();
        }
        try {
          const match = String(authHeader).match(/^Basic\s+([A-Za-z0-9+/=]+)/i);
          if (!match) throw new Error('Bad auth');
          const decoded = Buffer.from(match[1], 'base64').toString('utf8');
          const [user, pass] = decoded.split(':');
          if (this.username && (user !== this.username || pass !== this.password)) {
            ctx.setCode(webdav.HTTPCodes.Unauthorized);
            return ctx.response.end();
          }
        } catch (_) {
          ctx.setCode(webdav.HTTPCodes.Unauthorized);
          return ctx.response.end();
        }
      } else {
        // If auth not required, some DAV clients still probe: provide challenge only for PROPFIND/HEAD/GET without creds
        if (!authHeader && (method === 'PROPFIND' || method === 'HEAD' || method === 'GET')) {
          ctx.response.setHeader('DAV', '1,2');
          ctx.response.setHeader('MS-Author-Via', 'DAV');
        }
      }
      // Confirmation helper for mutating methods
      const confirmPublish = async () => {
        try {
          // Ask renderer to confirm publishing to IPFS (unencrypted)
          if (this.services?.spkClient?.mainWindow) {
            const { webContents } = this.services.spkClient.mainWindow;
            const requestId = `webdav-confirm-${Date.now()}-${Math.random()}`;
            return await new Promise((resolve) => {
              const replyChannel = 'webdav:confirm-reply:' + requestId;
              const timeout = setTimeout(() => resolve(true), 5000); // default allow after 5s
              const listener = (_e, approved) => {
                try { webContents.removeAllListeners(replyChannel); } catch (_) {}
                clearTimeout(timeout);
                resolve(Boolean(approved));
              };
              webContents.once(replyChannel, listener);
              webContents.send('webdav:confirm', { requestId });
            });
          }
        } catch (_) {}
        return true;
      };

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
            return ctx.response.end();
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
          return ctx.response.end();
        } catch (e) {
          ctx.setCode(webdav.HTTPCodes.NotFound);
          return ctx.response.end();
        }
      }

      // Intercept GET for file proxying; PUT/MKCOL to upload via direct upload
      if (!ctx.requested.path.isRoot()) {
        // PUT: upload/replace file into current path (publish to IPFS)
        if (method === 'PUT') {
          try {
            const ok = await confirmPublish();
            if (!ok) {
              ctx.setCode(webdav.HTTPCodes.Forbidden);
              return ctx.response.end('Upload cancelled');
            }
            const parts = ctx.requested.path.paths;
            const username = parts[0];
            const subPath = parts.slice(1).join('/');
            if (!username || !subPath) {
              ctx.setCode(webdav.HTTPCodes.BadRequest);
              return ctx.response.end('Bad path');
            }
            // Read request body into buffer
            const chunks = [];
            await new Promise((resolve, reject) => {
              ctx.request.on('data', (d) => chunks.push(Buffer.from(d)));
              ctx.request.on('end', resolve);
              ctx.request.on('error', reject);
            });
            const buffer = Buffer.concat(chunks);
            const filename = decodeURIComponent(subPath.split('/').pop() || 'upload');

            // Ensure active account
            const spkWrapper = this.services?.spkClient;
            const active = spkWrapper?.getActiveAccount?.();
            if (!active || (typeof active === 'object' && !active.username)) {
              ctx.setCode(webdav.HTTPCodes.Forbidden);
              return ctx.response.end('No active account');
            }
            // Use direct simple upload pipeline from main process services
            // Convert to expected format
            const uploadSvc = this.services?.directUploadService;
            if (!uploadSvc) {
              ctx.setCode(webdav.HTTPCodes.InternalServerError);
              return ctx.response.end('Upload service unavailable');
            }

            // Ensure spk client on upload service
            if (!uploadSvc.spkClient) {
              const SPK = require('@disregardfiat/spk-js');
              const SPKKeychainAdapter = require('../../core/spk/keychain-adapter');
              const keychainAdapter = new SPKKeychainAdapter(this.services.spkClient.accountManager);
              const spk = new SPK(typeof active === 'string' ? active : active.username, { keychain: keychainAdapter });
              try { await spk.init(); } catch (_) {}
              uploadSvc.spkClient = spk;
            }

            const result = await uploadSvc.directUpload([
              { name: filename, size: buffer.length, type: 'application/octet-stream', buffer }
            ], { metadata: { folder: subPath.split('/').slice(0, -1).join('/') } });

            const first = Array.isArray(result?.files) ? result.files[0] : result;
            if (!first?.cid) throw new Error('No CID returned');

            ctx.setCode(webdav.HTTPCodes.Created);
            ctx.response.setHeader('ETag', '"' + first.cid + '"');
            return ctx.response.end();
          } catch (e) {
            ctx.setCode(webdav.HTTPCodes.InternalServerError);
            return ctx.response.end('Upload failed');
          }
        }

        // MKCOL: ensure virtual folder exists (no-op against Honeygraph; return Created)
        if (method === 'MKCOL') {
          try {
            const ok = await confirmPublish();
            if (!ok) {
              ctx.setCode(webdav.HTTPCodes.Forbidden);
              return ctx.response.end('Cancelled');
            }
            ctx.setCode(webdav.HTTPCodes.Created);
            return ctx.response.end();
          } catch (_) {
            ctx.setCode(webdav.HTTPCodes.Created);
            return ctx.response.end();
          }
        }

        if (method === 'GET') {
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
            return ctx.response.end();
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

            // Thumbnail proxy: /_thumb/:cid
            if (parsed.pathname.startsWith('/_thumb/')) {
              const cid = decodeURIComponent(parsed.pathname.substring('/_thumb/'.length)).replace(/\/+$/, '');
              // Basic CID validation (Base58btc-ish conservative)
              if (!cid || !/^[A-Za-z0-9]+$/.test(cid)) {
                res.statusCode = 400;
                res.end('Bad thumbnail CID');
                return;
              }
              try {
                const upstream = await axios.get(`https://ipfs.dlux.io/ipfs/${encodeURIComponent(cid)}`, {
                  responseType: 'stream',
                  maxRedirects: 5
                });
                res.statusCode = upstream.status;
                const ct = upstream.headers['content-type'] || 'image/jpeg';
                const cl = upstream.headers['content-length'];
                res.setHeader('Content-Type', ct);
                if (cl) res.setHeader('Content-Length', cl);
                res.setHeader('Cache-Control', 'public, max-age=86400');
                upstream.data.pipe(res);
              } catch (e) {
                res.statusCode = 404;
                res.end('Thumbnail Not Found');
              }
              return;
            }
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
                        const thumbCid = !dir && item.thumbnail ? String(item.thumbnail) : '';
                        const icon = dir
                          ? '📁'
                          : (thumbCid
                              ? `<img src="/_thumb/${encodeURIComponent(thumbCid)}" alt="thumb" width="32" height="32" style="object-fit:cover;vertical-align:middle;border-radius:4px" loading="lazy">`
                              : '📄');
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
    return { running: true, port: this.port, requireAuth: this.requireAuth };
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
    ipcMain.handle('webdav:start', async (_e, configOrPort) => this.start(configOrPort));
    ipcMain.handle('webdav:stop', async () => this.stop());
    ipcMain.handle('webdav:status', async () => ({ running: !!this.httpServer, port: this.port, requireAuth: this.requireAuth }));
    ipcMain.handle('webdav:configure', async (_e, cfg) => {
      // Update config (will take effect on next start). If running, restart.
      const wasRunning = !!this.httpServer;
      if (wasRunning) await this.stop();
      this.port = Number(cfg?.port ?? this.port) || this.port;
      this.requireAuth = Boolean(cfg?.requireAuth ?? this.requireAuth);
      this.username = String(cfg?.username ?? this.username);
      this.password = String(cfg?.password ?? this.password);
      if (wasRunning) await this.start();
      return { success: true, running: !!this.httpServer, port: this.port, requireAuth: this.requireAuth };
    });
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
    const thumbCid = !isDir && item.thumbnail ? String(item.thumbnail) : '';
    const thumbHref = thumbCid ? '/_thumb/' + encodeURIComponent(thumbCid) : '';
    responses.push(responseXml(href, isDir, size, item.mimeType || 'application/octet-stream', thumbHref));
  }
  return `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:o="urn:oratr">
${responses.join('\n')}
</d:multistatus>`;
}

function responseXml(href, isCollection, size = 0, contentType = 'application/octet-stream', thumbnailHref = '') {
  return `<d:response>
  <d:href>${xmlEscape(href)}</d:href>
  <d:propstat>
    <d:prop>
      <d:displayname>${xmlEscape(decodeURIComponent(href.split('/').filter(Boolean).pop() || ''))}</d:displayname>
      ${isCollection ? '<d:resourcetype><d:collection/></d:resourcetype>' : '<d:resourcetype/>'}
      ${!isCollection ? `<d:getcontentlength>${size}</d:getcontentlength>
      <d:getcontenttype>${xmlEscape(contentType)}</d:getcontenttype>` : ''}
      ${thumbnailHref ? `<o:thumbnail-href>${xmlEscape(thumbnailHref)}</o:thumbnail-href>` : ''}
    </d:prop>
    <d:status>HTTP/1.1 200 OK</d:status>
  </d:propstat>
</d:response>`;
}

function combineName(name, extension) {
  return extension ? `${name}.${extension}` : `${name}`;
}

module.exports = WebDavService;


