const fs = require('fs').promises;
const path = require('path');

/**
 * M3U8 Playlist Processor
 * Handles parsing and rewriting of HLS playlists with IPFS URLs
 */
class PlaylistProcessor {
  constructor(config = {}) {
    this.ipfsGateway = config.ipfsGateway || 'https://ipfs.dlux.io';
  }

  /**
   * Parse M3U8 playlist content
   */
  parsePlaylist(content) {
    if (!content.includes('#EXTM3U')) {
      throw new Error('Invalid M3U8 playlist format');
    }

    const lines = content.split('\n').filter(line => line.trim());
    const playlist = {
      version: 3,
      targetDuration: 10,
      segments: [],
      endList: false
    };

    let currentSegment = {};

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith('#EXT-X-VERSION:')) {
        playlist.version = parseInt(line.split(':')[1]);
      } else if (line.startsWith('#EXT-X-TARGETDURATION:')) {
        playlist.targetDuration = parseInt(line.split(':')[1]);
      } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
        playlist.mediaSequence = parseInt(line.split(':')[1]);
      } else if (line.startsWith('#EXTINF:')) {
        const duration = parseFloat(line.split(':')[1].split(',')[0]);
        currentSegment = { duration };
      } else if (line.startsWith('#EXT-X-ENDLIST')) {
        playlist.endList = true;
      } else if (!line.startsWith('#') && line.length > 0) {
        // This is a segment URI
        currentSegment.uri = line;
        playlist.segments.push(currentSegment);
        currentSegment = {};
      }
    }

    return playlist;
  }

  /**
   * Parse master playlist
   */
  parseMasterPlaylist(content) {
    if (!content.includes('#EXTM3U')) {
      throw new Error('Invalid M3U8 playlist format');
    }

    const lines = content.split('\n').filter(line => line.trim());
    const playlist = {
      version: 3,
      variants: []
    };

    let currentVariant = {};

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith('#EXT-X-VERSION:')) {
        playlist.version = parseInt(line.split(':')[1]);
      } else if (line.startsWith('#EXT-X-STREAM-INF:')) {
        // Parse stream info
        const info = line.substring('#EXT-X-STREAM-INF:'.length);
        const attributes = this.parseAttributes(info);
        
        currentVariant = {
          bandwidth: parseInt(attributes.BANDWIDTH) || 0,
          resolution: attributes.RESOLUTION || null,
          codecs: attributes.CODECS || null
        };
      } else if (!line.startsWith('#') && line.length > 0 && Object.keys(currentVariant).length > 0) {
        // This is the variant URI
        currentVariant.uri = line;
        playlist.variants.push(currentVariant);
        currentVariant = {};
      }
    }

    return playlist;
  }

  /**
   * Parse attribute string
   */
  parseAttributes(attributeString) {
    const attributes = {};
    const regex = /([A-Z-]+)=(?:"([^"]+)"|([^,]+))/g;
    let match;

    while ((match = regex.exec(attributeString)) !== null) {
      const key = match[1];
      const value = match[2] || match[3];
      attributes[key] = value;
    }

    return attributes;
  }

  /**
   * Rewrite playlist with IPFS URLs
   */
  rewritePlaylistWithIPFS(content, segmentHashes) {
    const lines = content.split('\n');
    const rewritten = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Check if this line is a segment reference
      if (!line.startsWith('#') && line.trim().length > 0) {
        const segmentName = this.extractFilename(line);
        const hash = segmentHashes[segmentName];
        
        if (!hash) {
          throw new Error(`Missing hash for segment: ${segmentName}`);
        }
        
        rewritten.push(this.createIPFSUrl(hash, segmentName));
      } else {
        rewritten.push(line);
      }
    }

    return rewritten.join('\n');
  }

  /**
   * Rewrite master playlist with IPFS URLs
   */
  rewriteMasterPlaylistWithIPFS(content, playlistHashes) {
    const lines = content.split('\n');
    const rewritten = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Check if this line is a playlist reference
      if (!line.startsWith('#') && line.trim().length > 0) {
        const playlistName = this.extractFilename(line);
        const hash = playlistHashes[playlistName];
        
        if (!hash) {
          throw new Error(`Missing hash for playlist: ${playlistName}`);
        }
        
        rewritten.push(this.createIPFSUrl(hash, playlistName));
      } else {
        rewritten.push(line);
      }
    }

    return rewritten.join('\n');
  }

  /**
   * Extract filename from URI
   */
  extractFilename(uri) {
    // Handle absolute URLs
    if (uri.includes('://')) {
      const url = new URL(uri);
      return path.basename(url.pathname);
    }
    
    // Handle absolute paths
    if (uri.startsWith('/')) {
      return path.basename(uri);
    }
    
    // Handle relative paths
    return path.basename(uri);
  }

  /**
   * Create IPFS URL
   */
  createIPFSUrl(hash, filename) {
    return `${this.ipfsGateway}/ipfs/${hash}?filename=${encodeURIComponent(filename)}`;
  }

  /**
   * Rewrite segment URL
   */
  rewriteSegmentUrl(segmentUri, segmentHashes) {
    const filename = this.extractFilename(segmentUri);
    const hash = segmentHashes[filename];
    
    if (!hash) {
      throw new Error(`Missing hash for segment: ${filename}`);
    }
    
    return this.createIPFSUrl(hash, filename);
  }

  /**
   * Validate playlist format
   */
  isValidPlaylist(content) {
    return content.includes('#EXTM3U') && 
           (content.includes('#EXTINF:') || content.includes('#EXT-X-STREAM-INF:'));
  }

  /**
   * Validate all segments have hashes
   */
  validateSegmentHashes(playlistContent, segmentHashes) {
    const parsed = this.parsePlaylist(playlistContent);
    
    for (const segment of parsed.segments) {
      const filename = this.extractFilename(segment.uri);
      if (!segmentHashes[filename]) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Create master playlist from resolution data
   */
  createMasterPlaylist(resolutions) {
    const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];
    
    // Sort by bandwidth (highest first)
    const sorted = [...resolutions].sort((a, b) => b.bandwidth - a.bandwidth);
    
    for (const resolution of sorted) {
      const streamInfo = [`BANDWIDTH=${resolution.bandwidth}`];
      
      if (resolution.width && resolution.height) {
        streamInfo.push(`RESOLUTION=${resolution.width}x${resolution.height}`);
      }
      
      if (resolution.codecs) {
        streamInfo.push(`CODECS="${resolution.codecs}"`);
      }
      
      lines.push(`#EXT-X-STREAM-INF:${streamInfo.join(',')}`);
      
      // Use IPFS URL if hash is provided
      if (resolution.hash) {
        lines.push(this.createIPFSUrl(resolution.hash, resolution.filename));
      } else {
        lines.push(resolution.filename);
      }
    }
    
    return lines.join('\n');
  }

  /**
   * Extract segment filenames from playlist
   */
  extractSegmentFilenames(playlistContent) {
    const segments = [];
    const lines = playlistContent.split('\n');
    
    for (const line of lines) {
      if (!line.startsWith('#') && line.trim().length > 0) {
        segments.push(this.extractFilename(line.trim()));
      }
    }
    
    return segments;
  }

  /**
   * Process playlist file
   */
  async processPlaylistFile(playlistPath, segmentHashes) {
    const content = await fs.readFile(playlistPath, 'utf-8');
    const rewritten = this.rewritePlaylistWithIPFS(content, segmentHashes);
    return rewritten;
  }

  /**
   * Process master playlist file
   */
  async processMasterPlaylistFile(playlistPath, playlistHashes) {
    const content = await fs.readFile(playlistPath, 'utf-8');
    const rewritten = this.rewriteMasterPlaylistWithIPFS(content, playlistHashes);
    return rewritten;
  }

  /**
   * Calculate playlist duration
   */
  calculatePlaylistDuration(playlistContent) {
    const parsed = this.parsePlaylist(playlistContent);
    return parsed.segments.reduce((total, segment) => total + segment.duration, 0);
  }

  /**
   * Get playlist info
   */
  getPlaylistInfo(playlistContent) {
    const parsed = this.parsePlaylist(playlistContent);
    
    return {
      version: parsed.version,
      targetDuration: parsed.targetDuration,
      segmentCount: parsed.segments.length,
      totalDuration: this.calculatePlaylistDuration(playlistContent),
      isComplete: parsed.endList,
      averageSegmentDuration: parsed.segments.length > 0 
        ? this.calculatePlaylistDuration(playlistContent) / parsed.segments.length 
        : 0
    };
  }
}

module.exports = PlaylistProcessor;