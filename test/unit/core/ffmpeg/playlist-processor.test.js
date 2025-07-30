const PlaylistProcessor = require('../../../../src/core/ffmpeg/playlist-processor');

describe('PlaylistProcessor', () => {
  let processor;

  beforeEach(() => {
    processor = new PlaylistProcessor();
  });

  describe('M3U8 parsing', () => {
    test('should parse M3U8 playlist', () => {
      const m3u8Content = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:10.0,
segment_000.ts
#EXTINF:10.0,
segment_001.ts
#EXTINF:5.5,
segment_002.ts
#EXT-X-ENDLIST`;

      const parsed = processor.parsePlaylist(m3u8Content);
      
      expect(parsed.version).toBe(3);
      expect(parsed.targetDuration).toBe(10);
      expect(parsed.segments).toHaveLength(3);
      expect(parsed.segments[0].duration).toBe(10.0);
      expect(parsed.segments[0].uri).toBe('segment_000.ts');
    });

    test('should parse master playlist', () => {
      const masterContent = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
1080p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720
720p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=854x480
480p.m3u8`;

      const parsed = processor.parseMasterPlaylist(masterContent);
      
      expect(parsed.variants).toHaveLength(3);
      expect(parsed.variants[0].bandwidth).toBe(5000000);
      expect(parsed.variants[0].resolution).toBe('1920x1080');
      expect(parsed.variants[0].uri).toBe('1080p.m3u8');
    });
  });

  describe('IPFS URL rewriting', () => {
    test('should rewrite segment URLs to IPFS', () => {
      const m3u8Content = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXTINF:10.0,
segment_000.ts
#EXTINF:10.0,
segment_001.ts
#EXT-X-ENDLIST`;

      const segmentHashes = {
        'segment_000.ts': 'QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco',
        'segment_001.ts': 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG'
      };

      const rewritten = processor.rewritePlaylistWithIPFS(m3u8Content, segmentHashes);
      
      expect(rewritten).toContain('https://ipfs.dlux.io/ipfs/QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco?filename=segment_000.ts');
      expect(rewritten).toContain('https://ipfs.dlux.io/ipfs/QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG?filename=segment_001.ts');
    });

    test('should rewrite master playlist URLs to IPFS', () => {
      const masterContent = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
1080p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720
720p.m3u8`;

      const playlistHashes = {
        '1080p.m3u8': 'QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco',
        '720p.m3u8': 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG'
      };

      const rewritten = processor.rewriteMasterPlaylistWithIPFS(masterContent, playlistHashes);
      
      expect(rewritten).toContain('https://ipfs.dlux.io/ipfs/QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco?filename=1080p.m3u8');
      expect(rewritten).toContain('https://ipfs.dlux.io/ipfs/QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG?filename=720p.m3u8');
    });

    test('should preserve original filenames in query parameters', () => {
      const segmentHashes = {
        'my_video_segment_000.ts': 'QmHash1'
      };

      const rewritten = processor.rewriteSegmentUrl('my_video_segment_000.ts', segmentHashes);
      
      expect(rewritten).toBe('https://ipfs.dlux.io/ipfs/QmHash1?filename=my_video_segment_000.ts');
    });

    test('should handle absolute URLs in playlists', () => {
      const m3u8Content = `#EXTM3U
#EXTINF:10.0,
https://example.com/segment_000.ts
#EXTINF:10.0,
/path/to/segment_001.ts`;

      const segmentHashes = {
        'segment_000.ts': 'QmHash1',
        'segment_001.ts': 'QmHash2'
      };

      const rewritten = processor.rewritePlaylistWithIPFS(m3u8Content, segmentHashes);
      
      expect(rewritten).toContain('https://ipfs.dlux.io/ipfs/QmHash1?filename=segment_000.ts');
      expect(rewritten).toContain('https://ipfs.dlux.io/ipfs/QmHash2?filename=segment_001.ts');
    });
  });

  describe('playlist validation', () => {
    test('should validate M3U8 format', () => {
      const validM3u8 = `#EXTM3U
#EXT-X-VERSION:3
#EXTINF:10.0,
segment.ts
#EXT-X-ENDLIST`;

      const invalidM3u8 = `Not a valid playlist`;

      expect(processor.isValidPlaylist(validM3u8)).toBe(true);
      expect(processor.isValidPlaylist(invalidM3u8)).toBe(false);
    });

    test('should validate all segments have hashes', () => {
      const m3u8Content = `#EXTM3U
#EXTINF:10.0,
segment_000.ts
#EXTINF:10.0,
segment_001.ts`;

      const completeHashes = {
        'segment_000.ts': 'QmHash1',
        'segment_001.ts': 'QmHash2'
      };

      const incompleteHashes = {
        'segment_000.ts': 'QmHash1'
      };

      expect(processor.validateSegmentHashes(m3u8Content, completeHashes)).toBe(true);
      expect(processor.validateSegmentHashes(m3u8Content, incompleteHashes)).toBe(false);
    });
  });

  describe('playlist generation', () => {
    test('should create master playlist from resolution data', () => {
      const resolutions = [
        {
          resolution: '1080p',
          width: 1920,
          height: 1080,
          bandwidth: 5000000,
          filename: '1080p.m3u8',
          hash: 'QmHash1080p'
        },
        {
          resolution: '720p',
          width: 1280,
          height: 720,
          bandwidth: 2500000,
          filename: '720p.m3u8',
          hash: 'QmHash720p'
        }
      ];

      const master = processor.createMasterPlaylist(resolutions);
      
      expect(master).toContain('#EXTM3U');
      expect(master).toContain('#EXT-X-VERSION:3');
      expect(master).toContain('BANDWIDTH=5000000,RESOLUTION=1920x1080');
      expect(master).toContain('https://ipfs.dlux.io/ipfs/QmHash1080p?filename=1080p.m3u8');
    });

    test('should sort resolutions by bandwidth in master playlist', () => {
      const resolutions = [
        { resolution: '480p', bandwidth: 1000000, width: 854, height: 480, filename: '480p.m3u8', hash: 'QmHash480' },
        { resolution: '1080p', bandwidth: 5000000, width: 1920, height: 1080, filename: '1080p.m3u8', hash: 'QmHash1080' },
        { resolution: '720p', bandwidth: 2500000, width: 1280, height: 720, filename: '720p.m3u8', hash: 'QmHash720' }
      ];

      const master = processor.createMasterPlaylist(resolutions);
      const lines = master.split('\n');
      
      // Find bandwidth values in order
      const bandwidths = lines
        .filter(line => line.includes('BANDWIDTH'))
        .map(line => parseInt(line.match(/BANDWIDTH=(\d+)/)[1]));
      
      expect(bandwidths).toEqual([5000000, 2500000, 1000000]);
    });
  });

  describe('segment extraction', () => {
    test('should extract segment filenames from playlist', () => {
      const m3u8Content = `#EXTM3U
#EXT-X-VERSION:3
#EXTINF:10.0,
segment_000.ts
#EXTINF:10.0,
segment_001.ts
#EXTINF:5.5,
segment_002.ts
#EXT-X-ENDLIST`;

      const segments = processor.extractSegmentFilenames(m3u8Content);
      
      expect(segments).toEqual(['segment_000.ts', 'segment_001.ts', 'segment_002.ts']);
    });

    test('should handle various segment URL formats', () => {
      const m3u8Content = `#EXTM3U
#EXTINF:10.0,
segment_000.ts
#EXTINF:10.0,
./segments/segment_001.ts
#EXTINF:10.0,
https://example.com/segment_002.ts
#EXTINF:10.0,
/absolute/path/segment_003.ts`;

      const segments = processor.extractSegmentFilenames(m3u8Content);
      
      expect(segments).toContain('segment_000.ts');
      expect(segments).toContain('segment_001.ts');
      expect(segments).toContain('segment_002.ts');
      expect(segments).toContain('segment_003.ts');
    });
  });

  describe('error handling', () => {
    test('should throw on invalid playlist format', () => {
      const invalidContent = 'Not a playlist';
      
      expect(() => processor.parsePlaylist(invalidContent))
        .toThrow('Invalid M3U8 playlist format');
    });

    test('should throw on missing segment hash', () => {
      const m3u8Content = `#EXTM3U
#EXTINF:10.0,
segment_000.ts`;

      const incompleteHashes = {};
      
      expect(() => processor.rewritePlaylistWithIPFS(m3u8Content, incompleteHashes))
        .toThrow('Missing hash for segment: segment_000.ts');
    });

    test('should handle empty playlists gracefully', () => {
      const emptyPlaylist = '#EXTM3U\n#EXT-X-ENDLIST';
      const segments = processor.extractSegmentFilenames(emptyPlaylist);
      
      expect(segments).toEqual([]);
    });
  });
});