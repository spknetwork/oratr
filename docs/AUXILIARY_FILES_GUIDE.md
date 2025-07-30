# Auxiliary/Hidden Files Guide

## Overview

SPK Drive stores auxiliary files alongside main content files. These include:

- **Thumbnails** - Preview images for videos and documents
- **Video Segments** - `.ts` files for HLS streaming
- **Playlists** - `.m3u8` manifests for video streaming  
- **Posters** - Cover images for video content
- **Generated Files** - Auto-generated previews and metadata

These files are marked with a special flag (bit 2) in the contract metadata and are now handled as "hidden files" for better UX.

## Problem

Previously, auxiliary files were displayed alongside regular files, causing:
- Cluttered file browser with many small segment files
- Broken thumbnail previews for auxiliary files themselves
- Confusing UX where technical files mixed with user content

## Solution

The enhanced file browser now:

1. **Separates auxiliary files** from regular files
2. **Shows them in a dedicated "Hidden Files" section** with a simple list view
3. **Provides a toggle button** to show/hide these files
4. **Displays file type icons** to identify auxiliary file purposes
5. **Excludes them from folder navigation** to reduce clutter

## Implementation Details

### Identifying Auxiliary Files

Files are marked as auxiliary if they:

1. Have the auxiliary flag set (bit 2 in metadata flags)
2. Match naming patterns:
   - Contains `_thumb` or `thumbnail`
   - Contains `_poster`
   - Starts with `_` (hidden)
   - Ends with `.ts` (video segment)
   - Ends with `.m3u8` (playlist)

### File Types

The system identifies these auxiliary file types:

- `thumb` - Thumbnail images
- `poster` - Video poster/cover images
- `segment` - Video streaming segments (.ts files)
- `playlist` - Streaming manifests (.m3u8 files)
- `aux` - Other auxiliary files

### UI Changes

#### Toggle Button
```
👁️ Hidden Files (12)
```
Shows count of auxiliary files and toggles visibility.

#### Hidden Files Section
Simple list view showing:
- File type icon (🖼️, 🎬, 📹, 📋, 📎)
- File name
- File type badge
- File size
- Click to open in IPFS gateway

## Usage

### For Users

1. **Normal Usage**: Auxiliary files are hidden by default
2. **View Hidden Files**: Click the "Hidden Files" toggle
3. **Access Files**: Click any hidden file to view it
4. **Clean Interface**: Main files shown without clutter

### For Developers

```javascript
// Get regular files only (auxiliary excluded)
const files = driveInstance.getFiles(folderPath);

// Get auxiliary files separately
const auxiliaryFiles = driveInstance.getAuxiliaryFiles();

// Check if a file is auxiliary
const isHidden = driveInstance.isAuxiliaryFile(file);
```

## Benefits

1. **Cleaner Interface** - Users see only their content files
2. **Better Performance** - Fewer items to render in main view
3. **Technical Transparency** - Advanced users can still access auxiliary files
4. **Improved Navigation** - Folders contain only relevant files

## Example

A video upload might create:
- `my-video.mp4` - Main file (shown)
- `my-video_thumb.jpg` - Thumbnail (hidden)
- `my-video_poster.jpg` - Poster image (hidden)  
- `my-video.m3u8` - Streaming manifest (hidden)
- `my-video_001.ts` to `my-video_100.ts` - Segments (hidden)

With the new system, users only see `my-video.mp4` in their files, while the 100+ auxiliary files are tucked away in the hidden files section.

## Future Improvements

1. **Grouping** - Group auxiliary files by their parent file
2. **Filtering** - Filter hidden files by type
3. **Bulk Operations** - Delete all auxiliary files for a video
4. **Smart Display** - Show video poster as thumbnail for main file