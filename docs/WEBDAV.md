## Oratr WebDAV server

### Thumbnail icons in directory listings

The built-in WebDAV/HTTP server now renders file thumbnails as icons in HTML directory listings when Honeygraph returns a `thumbnail` CID for a file.

- Directory JSON source: `https://honeygraph.dlux.io/fs/:username/:path?` must include `thumbnail` per file when available
- Local proxy to fetch thumbnails: `/_thumb/:cid` (served via `ipfs.dlux.io`)
- Web UI: `<img>` icons are shown at 32x32 next to file names
- WebDAV (PROPFIND): a custom property is exposed for clients that read extra DAV properties:

  Namespace: `urn:oratr` (prefix `o`)

  Property: `o:thumbnail-href` → relative URL like `/_thumb/<cid>`

Clients that do not understand the custom property will ignore it.

### Quick tests

- HTML listing in a browser:

  Visit `http://127.0.0.1:4819/<username>/` and verify thumbnails render as icons where available.

- Fetch a thumbnail directly:

  ```bash
  curl -i http://127.0.0.1:4819/_thumb/<CID>
  ```

- Inspect PROPFIND response for the custom property:

  ```bash
  curl -i -X PROPFIND \
    -H 'Depth: 1' \
    http://127.0.0.1:4819/<username>/
  ```

  Look for `<o:thumbnail-href>` inside the multistatus for file resources.

### Notes

- Thumbnails are treated as hidden files in Honeygraph (bitflag 2) and are not listed as regular files. Only the `thumbnail` field is used to render icons.
- The server proxies thumbnails through `ipfs.dlux.io` and sets `Cache-Control: public, max-age=86400`.

### Uploading files (PUT) and creating folders (MKCOL)

- Drag and drop into a mounted WebDAV folder is supported. Files are published to IPFS unencrypted via a direct upload, after a confirmation prompt in the app.
- You can also use standard WebDAV clients or curl to upload:

  Upload a file (will publish to IPFS):

  ```bash
  curl -T ./local-file.jpg http://127.0.0.1:4819/<username>/Photos/local-file.jpg
  ```

  Create a folder path (no-op on-chain, for organization only):

  ```bash
  curl -X MKCOL http://127.0.0.1:4819/<username>/Photos/
  ```

  Notes:
  - On first upload, Oratr will ask for confirmation to publish to IPFS (unencrypted).
  - The file is added to the local IPFS node and a direct upload transaction is broadcast with basic metadata.
  - A successful upload responds with 201 Created and includes an ETag header with the new CID.


