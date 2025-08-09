// Docs Viewer Component
// Lists local markdown files and renders selected content

const fs = (window.require && window.require('fs')) || null;
const path = (window.require && window.require('path')) || null;

class DocsViewer {
  constructor(options = {}) {
    this.container = options.container || document.getElementById('docs-tab');
    this.roots = [];
    this.filesIndex = [];
    this.activeFile = null;
    this.initialized = false;
  }

  resolveRoots() {
    try {
      if (!fs || !path) { this.roots = []; return; }

      const attempts = [];

      const addAttempt = (p) => {
        try {
          if (p && typeof p === 'string' && !attempts.includes(p)) attempts.push(p);
        } catch (_) {}
      };

      // 1) From current page path (works in dev and most builds)
      try {
        const pagePath = decodeURIComponent(window.location.pathname || '');
        if (pagePath) {
          let current = path.dirname(pagePath);
          for (let i = 0; i < 8 && current && current !== path.dirname(current); i++) {
            addAttempt(path.join(current, 'docs'));
            addAttempt(path.join(current, 'oratr', 'docs'));
            // Handle app.asar packaged path by going one level up
            if (current.includes('app.asar')) {
              const up = path.resolve(current, '..');
              addAttempt(path.join(up, 'docs'));
              addAttempt(path.join(up, 'oratr', 'docs'));
            }
            current = path.resolve(current, '..');
          }
        }
      } catch (_) {}

      // 2) From this module location (robust in ESM)
      try {
        // import.meta.url is available in ESM
        const modulePath = decodeURIComponent(new URL(import.meta.url).pathname);
        let current = path.dirname(modulePath);
        for (let i = 0; i < 8 && current && current !== path.dirname(current); i++) {
          addAttempt(path.join(current, 'docs'));
          addAttempt(path.join(current, 'oratr', 'docs'));
          current = path.resolve(current, '..');
        }
      } catch (_) {}

      // 3) From cwd (packaged apps often run from install dir)
      try {
        addAttempt(path.join(process.cwd(), 'docs'));
        addAttempt(path.join(process.cwd(), 'oratr', 'docs'));
      } catch (_) {}

      // 4) From process.resourcesPath (Electron packaged)
      try {
        if (process && process.resourcesPath) {
          addAttempt(path.join(process.resourcesPath, 'docs'));
          addAttempt(path.join(process.resourcesPath, '..', 'docs'));
          addAttempt(path.join(process.resourcesPath, '..', 'oratr', 'docs'));
        }
      } catch (_) {}

      const roots = [];
      for (const candidate of attempts) {
        try {
          if (candidate && fs.existsSync(candidate)) {
            roots.push({ label: path.basename(candidate) === 'docs' ? 'oratr/docs' : candidate, dir: candidate });
          }
        } catch (_) {}
      }

      // De-duplicate by directory
      const seen = new Set();
      this.roots = roots.filter(r => (seen.has(r.dir) ? false : (seen.add(r.dir), true)));
    } catch (_) {
      this.roots = [];
    }
  }

  listMarkdownFiles(dir, relativePrefix = '') {
    const results = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        const rel = path.join(relativePrefix, entry.name);
        if (entry.isDirectory()) {
          // Shallow recursion, limit to 2 levels for now
          if (relativePrefix.split(path.sep).length < 2) {
            results.push(...this.listMarkdownFiles(full, rel));
          }
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
          results.push({ fullPath: full, relativePath: rel });
        }
      }
    } catch (_) {}
    // Sort alphabetically
    results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    return results;
  }

  buildIndex() {
    this.filesIndex = [];
    for (const root of this.roots) {
      const files = this.listMarkdownFiles(root.dir);
      this.filesIndex.push({ root, files });
    }
  }

  mount() {
    if (!this.container) return;
    if (!this.initialized) {
      this.injectStyles();
      this.initialized = true;
    }
    this.resolveRoots();
    this.buildIndex();
    this.render();
  }

  injectStyles() {
    if (document.getElementById('docs-viewer-styles')) return;
    const style = document.createElement('style');
    style.id = 'docs-viewer-styles';
    style.textContent = `
      .docs-layout { display: grid; grid-template-columns: 280px 1fr; height: calc(100vh - 140px); gap: 12px; }
      .docs-sidebar { border-right: 1px solid #e5e7eb; padding-right: 8px; overflow: auto; }
      .docs-content { overflow: auto; padding: 0 8px; }
      .docs-group { margin-bottom: 12px; }
      .docs-group h4 { margin: 10px 0 6px; font-size: 13px; color: #6b7280; text-transform: uppercase; }
      .docs-list { list-style: none; padding: 0; margin: 0; }
      .docs-list li { margin: 0; }
      .docs-list button { width: 100%; text-align: left; border: none; background: transparent; padding: 6px 8px; border-radius: 6px; cursor: pointer; }
      .docs-list button:hover { background: rgba(0,0,0,0.05); }
      .docs-active { background: rgba(0,123,255,0.12) !important; }
      .docs-toolbar { display: flex; gap: 8px; align-items: center; padding: 8px 0; border-bottom: 1px solid #e5e7eb; margin-bottom: 8px; }
      .docs-toolbar .path { color: #6b7280; font-size: 12px; }
      .docs-markdown { padding: 12px 0 60px; }
      .docs-markdown pre { background: #0f172a; color: #e2e8f0; padding: 10px; border-radius: 6px; overflow: auto; }
      .docs-markdown code { background: rgba(0,0,0,0.06); padding: 2px 4px; border-radius: 4px; }
      .docs-markdown table { border-collapse: collapse; }
      .docs-markdown th, .docs-markdown td { border: 1px solid #e5e7eb; padding: 6px 8px; }
      .docs-empty { color: #6b7280; padding: 8px; }
    `;
    document.head.appendChild(style);
  }

  render() {
    const layout = document.createElement('div');
    layout.className = 'docs-layout';

    // Sidebar
    const sidebar = document.createElement('div');
    sidebar.className = 'docs-sidebar';
    if (!fs || !path) {
      sidebar.innerHTML = `<div class="docs-empty">Docs viewer requires Node integration.</div>`;
    } else if (this.filesIndex.length === 0) {
      sidebar.innerHTML = `<div class="docs-empty">No markdown files found in oratr/docs.</div>`;
    } else {
      this.filesIndex.forEach(group => {
        const groupEl = document.createElement('div');
        groupEl.className = 'docs-group';
        groupEl.innerHTML = `<h4>${group.root.label}</h4>`;
        const ul = document.createElement('ul');
        ul.className = 'docs-list';
        group.files.forEach(file => {
          const li = document.createElement('li');
          const btn = document.createElement('button');
          btn.textContent = file.relativePath;
          btn.addEventListener('click', () => this.openFile(group.root, file));
          if (this.activeFile && this.activeFile.fullPath === file.fullPath) btn.classList.add('docs-active');
          li.appendChild(btn);
          ul.appendChild(li);
        });
        groupEl.appendChild(ul);
        sidebar.appendChild(groupEl);
      });
    }

    // Content
    const content = document.createElement('div');
    content.className = 'docs-content';
    content.innerHTML = `
      <div class="docs-toolbar">
        <div class="path" id="docs-path">${this.activeFile ? this.activeFile.fullPath : ''}</div>
        <div style="margin-left:auto; display:flex; gap:6px;">
          <button id="docs-refresh" class="btn btn-secondary btn-sm">Refresh</button>
          <button id="docs-open-external" class="btn btn-secondary btn-sm">Open Externally</button>
        </div>
      </div>
      <div class="docs-markdown" id="docs-markdown"></div>
    `;

    layout.appendChild(sidebar);
    layout.appendChild(content);

    this.container.innerHTML = '';
    this.container.appendChild(layout);

    // Wire toolbar actions
    const refreshBtn = this.container.querySelector('#docs-refresh');
    if (refreshBtn) refreshBtn.addEventListener('click', () => this.mount());
    const openBtn = this.container.querySelector('#docs-open-external');
    if (openBtn) openBtn.addEventListener('click', () => this.openExternal());

    if (this.activeFile) {
      this.renderMarkdown(this.activeFile.root, this.activeFile);
    } else if (this.filesIndex.length && this.filesIndex[0].files.length) {
      // Auto-open index.md if present, otherwise first file
      const firstRoot = this.filesIndex[0].root;
      const files = this.filesIndex[0].files;
      const indexPref = files.find(f => f.relativePath.toLowerCase().endsWith('index.md')) || files[0];
      this.openFile(firstRoot, indexPref);
    }
  }

  openFile(root, file) {
    this.activeFile = { ...file, root };
    this.render();
  }

  openExternal() {
    try {
      if (!this.activeFile) return;
      const { shell } = require('electron');
      shell.openPath(this.activeFile.fullPath);
    } catch (_) {}
  }

  renderMarkdown(root, file) {
    const el = this.container.querySelector('#docs-markdown');
    const pathEl = this.container.querySelector('#docs-path');
    if (pathEl) pathEl.textContent = file.fullPath;
    try {
      const md = fs.readFileSync(file.fullPath, 'utf8');
      const html = (window.marked && window.marked.parse)
        ? window.marked.parse(md)
        : this.fallbackMarkdown(md);
      el.innerHTML = html;
      this.fixupRelativeLinks(el, path.dirname(file.fullPath));
    } catch (e) {
      el.innerHTML = `<div class="docs-empty">Failed to read file: ${e.message}</div>`;
    }
  }

  fixupRelativeLinks(container, baseDir) {
    // Images
    container.querySelectorAll('img').forEach(img => {
      const src = img.getAttribute('src');
      if (!src) return;
      if (/^[a-z]+:\/\//i.test(src) || src.startsWith('data:') || src.startsWith('file:')) return;
      const resolved = 'file://' + path.resolve(baseDir, src);
      img.setAttribute('src', resolved);
    });
    // Anchor links to other markdown
    container.querySelectorAll('a').forEach(a => {
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#')) return;
      if (/^[a-z]+:\/\//i.test(href) || href.startsWith('file:') || href.startsWith('mailto:')) return;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const target = path.resolve(baseDir, href);
        if (fs.existsSync(target) && target.toLowerCase().endsWith('.md')) {
          const root = this.roots.find(r => target.startsWith(r.dir));
          const relativePath = root ? path.relative(root.dir, target) : path.basename(target);
          this.activeFile = { fullPath: target, relativePath, root: root || { label: path.basename(path.dirname(target)), dir: path.dirname(target) } };
          this.render();
        } else {
          try {
            const { shell } = require('electron');
            shell.openPath(target);
          } catch (_) {}
        }
      });
    });
  }

  fallbackMarkdown(text) {
    // Very minimal fallback: escape and preserve headings/code fences
    const esc = (s) => s.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
    const lines = text.split(/\r?\n/);
    let inCode = false;
    const out = [];
    for (const line of lines) {
      if (line.trim().startsWith('```')) {
        inCode = !inCode;
        out.push(inCode ? '<pre><code>' : '</code></pre>');
        continue;
      }
      if (inCode) { out.push(esc(line)); continue; }
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) { out.push(`<h${h[1].length}>${esc(h[2])}</h${h[1].length}>`); continue; }
      if (line.trim() === '') { out.push('<br/>'); continue; }
      out.push(`<p>${esc(line)}</p>`);
    }
    return out.join('\n');
  }
}

// Create singleton and expose globally
window.docsViewer = new DocsViewer();

export default DocsViewer;


