# SPK Desktop Build Instructions

## Overview

SPK Desktop is an Electron application that bundles video transcoding (FFmpeg), IPFS storage, and ProofOfAccess (POA) node capabilities into a desktop application for Windows, macOS, and Linux.
### UI notes (2025-08)

- Sidebar now always renders on startup to allow access to Docs prior to authentication.
- The Docs tab is briefly accented on first load to help new users find onboarding material.
- App version is displayed at the bottom of the sidebar; it is fetched from the main process via `app:getVersion`.
- Sidebar branding stacks the Oratr icon (50% larger) above the centered title.


## Prerequisites

- Node.js 18+ and npm
- Git
- Python (for native module compilation)
- Build tools for your platform:
  - **Windows**: Windows Build Tools or Visual Studio
  - **macOS**: Xcode Command Line Tools
  - **Linux**: build-essential package

## ProofOfAccess Integration

The application integrates ProofOfAccess in two ways:

1. **NPM Package** (Preferred): Uses `@disregardfiat/proofofaccess` npm package
2. **Direct Binary**: Downloads platform-specific binaries during build

### POA Binary Management

The POA binary is handled similarly to FFmpeg:
- Automatically downloaded during the build process
- Platform-specific binaries for all target platforms
- Bundled with the electron app in the `bin/` directory
- Spawned as a child process when needed

## Development Setup

```bash
# Clone the repository
git clone https://github.com/your-org/spk-desktop.git
cd spk-desktop

# Install dependencies
npm install

# The POA package is optional but recommended
npm install @disregardfiat/proofofaccess

# Run in development mode
npm start
```

## Building for Production

### Prepare Binaries

Before building, ensure all required binaries are downloaded:

```bash
# Download POA binaries for all platforms
npm run prebuild
```

This script will:
1. Check for the `@disregardfiat/proofofaccess` npm package
2. Download platform-specific POA binaries from GitHub releases
3. Place them in the `bin/` directory

### Build Commands

```bash
# Build for current platform
npm run build

# Build for specific platforms
npm run build:win    # Windows (NSIS installer + portable)
npm run build:mac    # macOS (DMG + ZIP)
npm run build:linux  # Linux (AppImage, DEB, RPM)

# Build for all platforms (on appropriate CI/CD system)
npm run build:all
```

## Platform-Specific Notes

### Windows

- Builds both NSIS installer and portable versions
- POA binary: `proofofaccess-windows-amd64.exe`
- Requires Windows 10 or later

### macOS

- Builds for both Intel (x64) and Apple Silicon (arm64)
- POA binaries:
  - Intel: `proofofaccess-darwin-amd64`
  - Apple Silicon: `proofofaccess-darwin-arm64`
- Requires macOS 10.13 or later

### Linux

- Builds AppImage, DEB, and RPM packages
- POA binaries:
  - x64: `proofofaccess-linux-amd64`
  - ARM64: `proofofaccess-linux-arm64`
- Requires glibc 2.17 or later

## Binary Sources

The application uses these binaries:

1. **FFmpeg**: Via `ffmpeg-static-electron` package
2. **ProofOfAccess**: Via `@disregardfiat/proofofaccess` or GitHub releases
3. **IPFS**: User must install separately (not bundled)

## Troubleshooting

### POA Binary Not Found

If the POA binary is not found during runtime:

1. Check if the npm package is installed:
   ```bash
   npm ls @disregardfiat/proofofaccess
   ```

2. Manually download binaries:
   ```bash
   node build/download-binaries.js
   ```

3. Verify binary permissions:
   ```bash
   ls -la bin/
   ```

### Build Failures

1. **Native modules**: Ensure Python and build tools are installed
2. **Permissions**: On Unix systems, ensure binaries are executable
3. **Network**: Binary downloads require internet access

## CI/CD Integration

For automated builds, ensure your CI/CD pipeline:

1. Installs all dependencies including optional ones
2. Runs the prebuild script before building
3. Has network access for downloading binaries
4. Sets appropriate code signing certificates (for production releases)

### GitHub Actions Example

```yaml
name: Build

on: [push, pull_request]

jobs:
  build:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      
      - name: Install dependencies
        run: npm ci
      
      - name: Download binaries
        run: npm run prebuild
      
      - name: Build
        run: npm run build
      
      - name: Upload artifacts
        uses: actions/upload-artifact@v3
        with:
          name: ${{ matrix.os }}-build
          path: dist/
```

## Manual POA Installation

If automatic installation fails, you can manually install POA:

1. Download the appropriate binary from [ProofOfAccess Releases](https://github.com/spknetwork/proofofaccess/releases)
2. Place it in the `bin/` directory with the correct name format
3. Make it executable (Unix systems): `chmod +x bin/proofofaccess-*`

## Security Considerations

- Binaries are downloaded over HTTPS from official GitHub releases
- Verify checksums when available
- Code sign your application for production releases
- Keep dependencies updated for security patches

## Resources

- [Electron Builder Documentation](https://www.electron.build/)
- [ProofOfAccess GitHub](https://github.com/spknetwork/proofofaccess)
- [SPK Network Documentation](https://spk.network/docs)