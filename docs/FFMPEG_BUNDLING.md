# FFmpeg Binary Bundling

Oratr now includes FFmpeg binaries as part of the package to eliminate external dependencies.

## How It Works

1. **Automatic Installation**: FFmpeg binaries are automatically downloaded and installed during `npm install`
2. **Platform Support**: Supports Windows, macOS (Intel & Apple Silicon), and Linux (x64 & ARM64)
3. **Fallback**: If bundled binaries fail, the system will fallback to system-installed FFmpeg

## Manual Installation

If automatic installation fails, you can manually install FFmpeg:

```bash
npm run install-ffmpeg
```

## Binary Locations

FFmpeg binaries are stored in:
- Development: `./bin/ffmpeg` and `./bin/ffprobe`
- Production (packaged): `resources/bin/ffmpeg` and `resources/bin/ffprobe`

## Platform-Specific Sources

- **macOS**: Downloaded from evermeet.cx (trusted FFmpeg builds for macOS)
- **Linux**: Downloaded from johnvansickle.com (static builds)
- **Windows**: Downloaded from gyan.dev (official Windows builds)

## Troubleshooting

### Binary Not Found
If you see "FFmpeg not found" errors:
1. Run `npm run install-ffmpeg`
2. Check that `./bin/` directory exists and contains ffmpeg/ffprobe
3. Verify file permissions (should be executable on Unix systems)

### Download Failures
If download fails:
1. Check your internet connection
2. Try manual download from the sources above
3. Place binaries manually in `./bin/` directory

### Permission Issues (Linux/macOS)
The install script automatically sets executable permissions, but if needed:
```bash
chmod +x ./bin/ffmpeg
chmod +x ./bin/ffprobe
```

## Build Integration

When building the Electron app:
- FFmpeg binaries are automatically included in the build
- No need for end-users to install FFmpeg separately
- Binaries are bundled in the `resources/bin` directory

## Development vs Production

- **Development**: Uses binaries from `./bin/`
- **Production**: Uses binaries from `resources/bin/` (packaged with Electron)
- **Fallback**: System PATH (if available)

## File Size Considerations

FFmpeg binaries add approximately:
- Windows: ~100MB
- macOS: ~50MB
- Linux: ~70MB

Consider using build-time optimization or separate downloads for production if size is critical.