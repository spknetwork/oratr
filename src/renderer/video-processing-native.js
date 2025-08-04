// Native FFmpeg Video Processing System
// Uses actual FFmpeg binary for fast, reliable transcoding

console.log('[Video Processing Native] Loading video processing functions...');

// Global variables for video processing
let currentTranscodingSession = null;
let generatedFiles = new Map();
let originalFiles = new Map(); // For preview
let ipfsReadyFiles = new Map(); // For upload
let hlsPlayer = null;
let thumbnailFrames = [];
let selectedThumbnail = null;
let transcodedFilePaths = new Map(); // Store file paths instead of file contents
let currentTempDir = null; // Keep track of temp directory

// Logging system
function addLog(message, type = 'info') {
    const container = document.getElementById('processing-logs');
    if (!container) return;
    
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry log-${type}`;
    logEntry.textContent = `[${timestamp}] ${message}`;
    
    container.appendChild(logEntry);
    container.scrollTop = container.scrollHeight;
}

// Make addLog available globally
window.addLog = addLog;

// Format bytes for display
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Initialize FFmpeg (check native binary)
async function initializeFFmpeg() {
    addLog('Checking FFmpeg binary availability...', 'info');
    
    try {
        // Test FFmpeg availability
        const result = await window.api.invoke('ffmpeg:getVersion');
        if (result.success) {
            addLog(`FFmpeg binary found: ${result.version}`, 'info');
            return true;
        } else {
            throw new Error(result.error);
        }
        
    } catch (error) {
        addLog(`FFmpeg binary not available: ${error.message}`, 'error');
        throw new Error('FFmpeg binary not found. Please install FFmpeg on your system.');
    }
}

// Format time for display
function formatTime(seconds) {
    if (!seconds || seconds < 0) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Calculate BROCA cost using SPK network stats
async function calculateBrocaCost(sizeInBytes, options = {}) {
    try {
        // Handle array of files
        const totalSize = Array.isArray(sizeInBytes) 
            ? sizeInBytes.reduce((sum, file) => sum + (file.size || file.fileSize || 0), 0)
            : sizeInBytes;
            
        // Use SPK client to calculate with live network stats
        const result = await window.api.invoke('spk:calculateBrocaCost', totalSize, options);
        if (result.success && result.data) {
            const cost = result.data.cost || 0;
            console.log('BROCA calculation result:', result.data);
            return cost;
        } else {
            // Fallback to default calculation if API fails
            console.warn('Failed to get live BROCA cost, using fallback:', result.error);
            return Math.ceil(totalSize / 1024);
        }
    } catch (error) {
        console.error('Error calculating BROCA cost:', error);
        // Fallback calculation: 1 BROCA per 1024 bytes
        const totalSize = Array.isArray(sizeInBytes) 
            ? sizeInBytes.reduce((sum, file) => sum + (file.size || file.fileSize || 0), 0)
            : sizeInBytes;
        return Math.ceil(totalSize / 1024);
    }
}

// Transcode video to HLS using native FFmpeg
async function transcodeToHLS(videoFile, options) {
    await initializeFFmpeg();
    
    currentTranscodingSession = `session_${Date.now()}`;
    generatedFiles.clear();
    originalFiles.clear();
    ipfsReadyFiles.clear();
    thumbnailFrames = [];
    selectedThumbnail = null;
    transcodedFilePaths.clear();
    currentTempDir = null;
    
    addLog(`Starting transcoding session: ${currentTranscodingSession}`, 'info');
    addLog(`Input file: ${videoFile.name} (${formatBytes(videoFile.size)})`, 'info');
    
    let totalTranscodedSize = videoFile.size; // Start with original size
    
    try {
        // Save video file to temporary location
        const tempDirResult = await window.api.invoke('ffmpeg:createTempDir');
        if (!tempDirResult.success) {
            throw new Error(tempDirResult.error);
        }
        const tempDir = tempDirResult.tempDir;
        currentTempDir = tempDir; // Store for later use
        
        // Convert video file to format expected by main process
        const videoFileData = {
            name: videoFile.name,
            data: await videoFile.arrayBuffer()
        };
        
        const inputPathResult = await window.api.invoke('ffmpeg:saveVideoFile', videoFileData, tempDir);
        if (!inputPathResult.success) {
            throw new Error(inputPathResult.error);
        }
        const inputPath = inputPathResult.inputPath;
        
        addLog(`Video saved to: ${inputPath}`, 'info');
        
        // Determine resolutions to transcode
        const resolutions = options.resolutions || ['720'];
        addLog(`Transcoding to resolutions: ${resolutions.join('p, ')}p`, 'info');
        
        const hlsFiles = [];
        const segmentFiles = [];
        
        // Generate thumbnail first
        addLog('Generating thumbnail...', 'info');
        updateUploadProgress(5, 'Generating thumbnail...', 'Transcoding');
        
        const thumbnailResult = await window.api.invoke('ffmpeg:generateThumbnail', inputPath, tempDir);
        if (!thumbnailResult.success) {
            throw new Error(thumbnailResult.error);
        }
        const thumbnailPath = thumbnailResult.thumbnailPath;
        
        const thumbnailDataResult = await window.api.invoke('ffmpeg:readFile', thumbnailPath);
        if (!thumbnailDataResult.success) {
            throw new Error(thumbnailDataResult.error);
        }
        const thumbnailData = new Uint8Array(thumbnailDataResult.data);
        
        const baseName = videoFile.name.replace(/\.[^/.]+$/, '');
        const thumbnailFile = new File([thumbnailData], `${baseName}_poster.jpg`, { 
            type: 'image/jpeg',
            lastModified: Date.now()
        });
        generatedFiles.set('thumbnail.jpg', thumbnailFile);
        transcodedFilePaths.set('thumbnail.jpg', thumbnailPath);
        addLog('Thumbnail generated successfully', 'info');
        
        // Set up FFmpeg progress handler
        let currentProgressBase = 10;
        let currentProgressScale = 80;
        
        const progressHandler = (progress) => {
            const percent = progress.percent || 0;
            const overallProgress = currentProgressBase + (percent * currentProgressScale / 100);
            updateUploadProgress(
                Math.round(overallProgress), 
                `Transcoding: ${Math.round(percent)}%`, 
                'Transcoding'
            );
        };
        
        window.api.on('ffmpeg:progress', progressHandler);
        
        try {
            // Transcode each resolution  
            let progressBase = 10;
            const progressPerResolution = 80 / resolutions.length;
            
            for (let i = 0; i < resolutions.length; i++) {
                const resolution = resolutions[i];
                
                addLog(`Transcoding resolution ${resolution}p (${i + 1}/${resolutions.length})...`, 'info');
                updateUploadProgress(progressBase, `Transcoding ${resolution}p...`, 'Transcoding');
                
                const playlistName = `${resolution}p_index.m3u8`;
                
                // Update progress handler for this resolution
                currentProgressBase = progressBase;
                currentProgressScale = progressPerResolution;
                
                // Start transcoding
                const transcodeResult = await window.api.invoke('ffmpeg:transcodeToHLS', inputPath, tempDir, resolution, {
                    onProgress: true
                });
                
                if (!transcodeResult.success) {
                    throw new Error(transcodeResult.error);
                }
                
                addLog(`Transcoding ${resolution}p completed`, 'info');
                
                // Read generated playlist
                const playlistDataResult = await window.api.invoke('ffmpeg:readFile', transcodeResult.playlistPath);
                if (!playlistDataResult.success) {
                    throw new Error(playlistDataResult.error);
                }
                const playlistData = new Uint8Array(playlistDataResult.data);
                let playlistContent = new TextDecoder().decode(playlistData);
                
                addLog(`Generated playlist ${playlistName}`, 'info');
                addLog(`Playlist content preview: ${playlistContent.substring(0, 200)}...`, 'debug');
            
                // Keep original playlist for preview
                const originalPlaylistFile = new File([playlistData], playlistName, { 
                    type: 'application/x-mpegURL' 
                });
                originalFiles.set(playlistName, originalPlaylistFile);
                
                // Store file path for later upload
                transcodedFilePaths.set(playlistName, transcodeResult.playlistPath);
                
                // Process segments
                const segments = transcodeResult.segments;
                let ipfsPlaylistContent = playlistContent;
                
                for (let i = 0; i < segments.length; i++) {
                    const segmentPath = segments[i];
                    const segmentName = segmentPath.split('/').pop();
                    const segmentDataResult = await window.api.invoke('ffmpeg:readFile', segmentPath);
                    if (!segmentDataResult.success) {
                        throw new Error(segmentDataResult.error);
                    }
                    const segmentData = new Uint8Array(segmentDataResult.data);
                    
                    // Create file object
                    const segmentFile = new File([segmentData], segmentName, { type: 'video/mp2t' });
                    originalFiles.set(segmentName, segmentFile);
                    // IMPORTANT: Also add to ipfsReadyFiles so it gets uploaded!
                    ipfsReadyFiles.set(segmentName, segmentFile);
                    totalTranscodedSize += segmentFile.size;
                    
                    // Store file path for later upload
                    transcodedFilePaths.set(segmentName, segmentPath);
                    
                    // Hash the segment to get IPFS CID
                    const segmentCID = await hashFile(segmentFile);
                    
                    // Replace in IPFS playlist
                    ipfsPlaylistContent = ipfsPlaylistContent.replace(
                        segmentName,
                        `https://ipfs.dlux.io/ipfs/${segmentCID}?filename=${segmentName}`
                    );
                    
                    segmentFiles.push(segmentName);
                    addLog(`Processed segment: ${segmentName} -> ${segmentCID}`, 'debug');
                    
                    // Generate thumbnail from first frame of first few segments
                    if (i < 5) { // Get thumbnails from first 5 segments
                        try {
                            const thumbnailResult = await window.api.invoke('ffmpeg:generateThumbnailFromSegment', 
                                segmentPath, tempDir, `thumb_${resolution}_${i}`);
                            if (thumbnailResult.success) {
                                const thumbDataResult = await window.api.invoke('ffmpeg:readFile', thumbnailResult.thumbnailPath);
                                if (thumbDataResult.success) {
                                    const thumbData = new Uint8Array(thumbDataResult.data);
                                    const thumbFile = new File([thumbData], `thumbnail_${resolution}_seg${i}.jpg`, { 
                                        type: 'image/jpeg' 
                                    });
                                    thumbnailFrames.push({
                                        file: thumbFile,
                                        resolution: resolution,
                                        segment: i,
                                        time: i * 10 // Assuming 10 second segments
                                    });
                                }
                            }
                        } catch (error) {
                            addLog(`Failed to generate thumbnail from segment ${i}: ${error.message}`, 'warn');
                        }
                    }
                }
                
                // Save IPFS-ready playlist to disk
                const ipfsPlaylistData = new TextEncoder().encode(ipfsPlaylistContent);
                const ipfsPlaylistFile = new File([ipfsPlaylistData], playlistName, { 
                    type: 'application/x-mpegURL' 
                });
                ipfsReadyFiles.set(playlistName, ipfsPlaylistFile);
                
                // Save to disk and track the path
                const ipfsPlaylistPath = `${tempDir}/${playlistName.replace('_index.m3u8', '_ipfs.m3u8')}`;
                const saveResult = await window.api.invoke('ffmpeg:saveFile', {
                    path: ipfsPlaylistPath,
                    data: Array.from(ipfsPlaylistData)
                });
                if (saveResult.success) {
                    transcodedFilePaths.set(playlistName, ipfsPlaylistPath);
                }
                
                hlsFiles.push({ 
                    name: playlistName, 
                    content: playlistContent, 
                    resolution: resolution + 'p',
                    height: parseInt(resolution)
                });
                
                addLog(`Generated ${segments.length} segments for ${resolution}p`, 'info');
                progressBase += progressPerResolution;
            }
        } finally {
            // Remove progress handler
            window.api.off('ffmpeg:progress', progressHandler);
        }
        
        // Create master playlists (both original and IPFS versions)
        addLog('Creating master playlists...', 'info');
        updateUploadProgress(95, 'Creating master playlists...', 'Transcoding');
        
        // Create original master playlist
        const masterPlaylist = createMasterPlaylist(hlsFiles);
        const masterFile = new File([masterPlaylist], 'master.m3u8', { 
            type: 'application/x-mpegURL' 
        });
        originalFiles.set('master.m3u8', masterFile);
        
        // Create IPFS-ready master playlist with CIDs
        let ipfsMasterPlaylist = masterPlaylist;
        for (const [filename, file] of ipfsReadyFiles) {
            if (filename.endsWith('_index.m3u8')) {
                const cid = await hashFile(file);
                ipfsMasterPlaylist = ipfsMasterPlaylist.replace(
                    new RegExp(filename, 'g'),
                    `https://ipfs.dlux.io/ipfs/${cid}?filename=${filename}`
                );
            }
        }
        const ipfsMasterFile = new File([ipfsMasterPlaylist], 'master.m3u8', { 
            type: 'application/x-mpegURL' 
        });
        ipfsReadyFiles.set('master.m3u8', ipfsMasterFile);
        
        // Save master playlist to disk and track the path
        const masterPath = `${tempDir}/master_ipfs.m3u8`;
        const saveMasterResult = await window.api.invoke('ffmpeg:saveFile', {
            path: masterPath,
            data: Array.from(new TextEncoder().encode(ipfsMasterPlaylist))
        });
        if (saveMasterResult.success) {
            transcodedFilePaths.set('master.m3u8', masterPath);
        }
        
        // Copy all original files to generatedFiles for compatibility
        for (const [name, file] of originalFiles) {
            generatedFiles.set(name, file);
        }
        
        // Add default thumbnail from video start
        if (thumbnailFrames.length === 0 || options.generateThumbnail) {
            // Use the thumbnail we generated at the beginning
            const defaultThumb = generatedFiles.get('thumbnail.jpg');
            if (defaultThumb) {
                thumbnailFrames.unshift({
                    file: defaultThumb,
                    resolution: 'original',
                    segment: -1,
                    time: 0
                });
            }
        }
        
        // Select first thumbnail as default
        if (thumbnailFrames.length > 0) {
            selectedThumbnail = thumbnailFrames[0];
        }
        
        // Calculate total transcoded size and BROCA cost
        const totalSize = totalTranscodedSize;
        const brocaCost = await calculateBrocaCost(totalSize);
        
        addLog('Master playlists created', 'info');
        addLog(`Master playlist:\n${masterPlaylist}`, 'debug');
        addLog(`Total transcoded size: ${formatBytes(totalSize)}`, 'info');
        addLog(`Estimated BROCA cost: ${brocaCost.toLocaleString()} BROCA (30 days)`, 'info');
        
        // Don't cleanup temp directory yet - we need the files for upload!
        addLog(`Files are in temp directory: ${tempDir}`, 'debug');
        
        updateUploadProgress(100, 'Transcoding completed!', 'Transcoding');
        addLog(`Transcoding complete! Generated ${originalFiles.size} files`, 'info');
        
        return {
            success: true,
            files: generatedFiles,
            originalFiles: originalFiles,
            ipfsReadyFiles: ipfsReadyFiles,
            masterPlaylist: masterPlaylist,
            hlsFiles: hlsFiles,
            segmentFiles: segmentFiles,
            thumbnailFrames: thumbnailFrames,
            totalSize: totalSize,
            brocaCost: brocaCost,
            tempDir: tempDir  // Keep track of temp directory for later cleanup
        };
        
    } catch (error) {
        addLog(`Transcoding failed: ${error.message}`, 'error');
        throw error;
    }
}

// Hash file to get IPFS CID
async function hashFile(file) {
    try {
        const buffer = await file.arrayBuffer();
        const result = await window.api.invoke('ipfs:calculateCid', {
            data: Array.from(new Uint8Array(buffer))
        });
        
        if (result.success) {
            return result.cid;
        } else {
            throw new Error(result.error || 'Failed to calculate CID');
        }
    } catch (error) {
        console.error('Failed to hash file:', error);
        // Fallback to a mock CID for development
        const buffer = await file.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return `Qm${hashHex.substring(0, 44)}`;
    }
}

// Create master HLS playlist
function createMasterPlaylist(hlsFiles) {
    let playlist = '#EXTM3U\n#EXT-X-VERSION:3\n\n';
    
    // Sort by resolution height
    hlsFiles.sort((a, b) => a.height - b.height);
    
    for (const hlsFile of hlsFiles) {
        const height = hlsFile.height;
        const width = getResolutionWidth(height);
        const bandwidth = estimateBandwidth(height);
        
        playlist += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${width}x${height}\n`;
        playlist += `${hlsFile.name}\n\n`;
    }
    
    return playlist;
}

// Estimate bandwidth for resolution
function estimateBandwidth(height) {
    const bandwidthMap = {
        240: 400000,   // 400 Kbps
        360: 800000,   // 800 Kbps
        480: 1200000,  // 1.2 Mbps
        720: 2500000,  // 2.5 Mbps
        1080: 5000000, // 5 Mbps
        1440: 8000000, // 8 Mbps
        2160: 15000000 // 15 Mbps
    };
    
    return bandwidthMap[height] || 2500000;
}

// Get resolution width from height
function getResolutionWidth(height) {
    const aspectRatio = 16 / 9; // Assume 16:9 aspect ratio
    return Math.round(height * aspectRatio);
}

// Show video preview with HLS player
async function showVideoPreview(transcodingResult) {
    addLog('Setting up video preview...', 'info');
    
    // Store the transcoding result for later use
    window.currentTranscodingResult = transcodingResult;
    
    // Hide processing panel, show preview panel
    document.getElementById('upload-progress').style.display = 'none';
    document.getElementById('video-preview').style.display = 'block';
    
    // Show total size and BROCA cost
    const infoContainer = document.getElementById('transcoding-info');
    if (infoContainer) {
        const brocaCost = transcodingResult.brocaCost || 0;
        infoContainer.innerHTML = `
            <p><strong>Total Size:</strong> ${formatBytes(transcodingResult.totalSize || 0)}</p>
            <p><strong>Storage Cost:</strong> ${brocaCost.toLocaleString()} BROCA (30 days)</p>
        `;
    }
    
    // Show thumbnail selector
    showThumbnailSelector();
    
    // Populate generated files list
    populateGeneratedFilesList();
    
    // Populate playlist selector with all IPFS-ready playlists
    const playlistSelector = document.getElementById('playlist-selector');
    if (playlistSelector) {
        playlistSelector.innerHTML = '<option value="master.m3u8">Master Playlist</option>';
        
        // Add resolution playlists
        for (const [filename, file] of ipfsReadyFiles) {
            if (filename.endsWith('_index.m3u8')) {
                const resolution = filename.replace('_index.m3u8', '');
                playlistSelector.innerHTML += `<option value="${filename}">${resolution} Playlist</option>`;
            }
        }
    }
    
    // Show IPFS-ready master playlist content by default
    const ipfsMasterFile = ipfsReadyFiles.get('master.m3u8');
    if (ipfsMasterFile) {
        const masterContent = await ipfsMasterFile.text();
        document.getElementById('m3u8-content').textContent = masterContent;
        addLog('Showing IPFS-ready master playlist with CIDs', 'info');
    }
    
    // Set up HLS player with original files
    setupHLSPlayer();
}

// Show thumbnail selector
function showThumbnailSelector() {
    const container = document.getElementById('thumbnail-selector');
    if (!container) return;
    
    container.innerHTML = '<h4>Select Thumbnail</h4>';
    
    const thumbGrid = document.createElement('div');
    thumbGrid.className = 'thumbnail-grid';
    
    // Add upload custom thumbnail option
    const uploadOption = document.createElement('div');
    uploadOption.className = 'thumbnail-option upload-option';
    uploadOption.innerHTML = `
        <input type="file" id="custom-thumb-input" accept="image/*" style="display: none;" onchange="handleCustomThumbnail(event)">
        <label for="custom-thumb-input" class="upload-thumb-label">
            <span>📷</span>
            <span>Upload Custom</span>
        </label>
    `;
    thumbGrid.appendChild(uploadOption);
    
    // Add generated thumbnails
    thumbnailFrames.forEach((thumb, index) => {
        const thumbOption = document.createElement('div');
        thumbOption.className = 'thumbnail-option';
        if (selectedThumbnail === thumb) {
            thumbOption.classList.add('selected');
        }
        
        const img = document.createElement('img');
        img.src = URL.createObjectURL(thumb.file);
        img.alt = `Thumbnail ${index + 1}`;
        
        const label = document.createElement('span');
        label.textContent = thumb.segment === -1 ? 'Start' : `${thumb.time}s`;
        
        thumbOption.appendChild(img);
        thumbOption.appendChild(label);
        thumbOption.onclick = () => selectThumbnail(thumb, thumbOption);
        
        thumbGrid.appendChild(thumbOption);
    });
    
    container.appendChild(thumbGrid);
}

// Handle thumbnail selection
function selectThumbnail(thumb, element) {
    selectedThumbnail = thumb;
    
    // Update UI
    document.querySelectorAll('.thumbnail-option').forEach(el => {
        el.classList.remove('selected');
    });
    if (element) {
        element.classList.add('selected');
    }
    
    addLog(`Selected thumbnail: ${thumb.time}s`, 'info');
}

// Handle custom thumbnail upload
async function handleCustomThumbnail(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    // Validate file type
    if (!file.type.startsWith('image/')) {
        showNotification('Please select an image file', 'error');
        return;
    }
    
    // Create thumbnail object
    const customThumb = {
        file: file,
        resolution: 'custom',
        segment: -1,
        time: 'custom'
    };
    
    // Add to thumbnails and select it
    thumbnailFrames.push(customThumb);
    selectedThumbnail = customThumb;
    
    // Refresh the thumbnail selector
    showThumbnailSelector();
    
    addLog('Custom thumbnail uploaded', 'info');
}

// Make function available globally
window.handleCustomThumbnail = handleCustomThumbnail;

// Populate the generated files list
function populateGeneratedFilesList() {
    const container = document.getElementById('generated-files-list');
    container.innerHTML = '';
    
    // Show original files for preview
    let totalSize = 0;
    for (const [filename, file] of originalFiles) {
        totalSize += file.size;
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        fileItem.innerHTML = `
            <span class="filename">${filename}</span>
            <span class="filesize">${formatBytes(file.size)}</span>
        `;
        container.appendChild(fileItem);
    }
    
    addLog(`Listed ${originalFiles.size} generated files (${formatBytes(totalSize)} total)`, 'info');
}

// Set up HLS player
function setupHLSPlayer() {
    const video = document.getElementById('preview-player');
    
    if (!window.Hls) {
        addLog('HLS.js not available, falling back to native playback', 'warn');
        return;
    }
    
    if (hlsPlayer) {
        hlsPlayer.destroy();
    }
    
    hlsPlayer = new window.Hls({
        debug: false,
        enableWorker: true
    });
    
    // Create blob URLs for original files so HLS player can access them
    const blobUrls = new Map();
    for (const [filename, file] of originalFiles) {
        blobUrls.set(filename, URL.createObjectURL(file));
    }
    
    // Override HLS loader to use our blob URLs
    const originalLoader = hlsPlayer.config.loader;
    hlsPlayer.config.loader = class extends originalLoader {
        load(context, config, callbacks) {
            const filename = context.url.split('/').pop().split('?')[0];
            if (blobUrls.has(filename)) {
                context.url = blobUrls.get(filename);
            }
            super.load(context, config, callbacks);
        }
    };
    
    const masterFile = generatedFiles.get('master.m3u8');
    if (masterFile) {
        hlsPlayer.loadSource(URL.createObjectURL(masterFile));
        hlsPlayer.attachMedia(video);
        
        hlsPlayer.on(window.Hls.Events.MANIFEST_PARSED, () => {
            addLog('HLS manifest loaded, ready to play', 'info');
            video.play().catch(e => addLog(`Autoplay failed: ${e.message}`, 'warn'));
        });
        
        hlsPlayer.on(window.Hls.Events.ERROR, (event, data) => {
            addLog(`HLS error: ${data.type} - ${data.details}`, 'error');
        });
    }
}

// Navigation functions
function retranscode() {
    addLog('Restarting transcoding process...', 'info');
    document.getElementById('video-preview').style.display = 'none';
    document.getElementById('upload-options').style.display = 'block';
    
    // Clean up
    if (hlsPlayer) {
        hlsPlayer.destroy();
        hlsPlayer = null;
    }
    
    // Clean up blob URLs
    for (const [filename, file] of generatedFiles) {
        const url = URL.createObjectURL(file);
        URL.revokeObjectURL(url);
    }
    
    generatedFiles.clear();
}

function proceedToUpload() {
    addLog('Proceeding to upload stage...', 'info');
    document.getElementById('video-preview').style.display = 'none';
    document.getElementById('upload-stage').style.display = 'block';
    
    // Update video information to show transcoded data
    updateUploadStageInfo();
    
    // Set up upload method selection
    setupUploadMethodSelection();
}

function updateUploadStageInfo() {
    // Create info panel if it doesn't exist
    const uploadStage = document.getElementById('upload-stage');
    let infoPanel = document.getElementById('upload-video-info');
    
    if (!infoPanel) {
        infoPanel = document.createElement('div');
        infoPanel.id = 'upload-video-info';
        infoPanel.className = 'info-panel';
        uploadStage.insertBefore(infoPanel, uploadStage.firstChild.nextSibling);
    }
    
    // Calculate total size from transcoded files
    let totalSize = 0;
    let fileCount = 0;
    let resolutions = new Set();
    
    // Count transcoded files
    for (const [filename, file] of ipfsReadyFiles) {
        totalSize += file.size;
        fileCount++;
        
        // Extract resolution from filename (e.g., "video_720p.m3u8")
        const resMatch = filename.match(/_(\d+)p/);
        if (resMatch) {
            resolutions.add(resMatch[1] + 'p');
        }
    }
    
    // Add thumbnail if selected
    if (selectedThumbnail) {
        totalSize += selectedThumbnail.file.size;
        fileCount++;
    }
    
    // Display transcoded video information
    infoPanel.innerHTML = `
        <h4>Transcoded Video Information</h4>
        <div class="video-details">
            <p><strong>Original File:</strong> ${selectedVideo?.name || 'Unknown'}</p>
            <p><strong>Transcoded Files:</strong> ${fileCount} files</p>
            <p><strong>Total Size:</strong> ${formatBytes(totalSize)}</p>
            <p><strong>Resolutions:</strong> ${Array.from(resolutions).sort((a, b) => parseInt(a) - parseInt(b)).join(', ') || 'Various'}</p>
            <p><strong>Format:</strong> HLS (HTTP Live Streaming)</p>
            <p><strong>Estimated Storage Cost:</strong> <span id="upload-broca-cost">Calculating...</span></p>
        </div>
    `;
    
    // Calculate and update BROCA cost
    calculateAndDisplayBrocaCost(totalSize);
}

async function calculateAndDisplayBrocaCost(totalSize) {
    try {
        const cost = await calculateBrocaCost(totalSize);
        document.getElementById('upload-broca-cost').innerHTML = `${cost.toLocaleString()} BROCA (30 days)`;
    } catch (error) {
        console.error('Failed to calculate BROCA cost:', error);
        document.getElementById('upload-broca-cost').innerHTML = `Error calculating cost`;
    }
}

function backToPreview() {
    document.getElementById('upload-stage').style.display = 'none';
    document.getElementById('video-preview').style.display = 'block';
}

function setupUploadMethodSelection() {
    const container = document.getElementById('upload-method-selection');
    
    // Check direct upload availability
    checkDirectUploadAvailability().then(result => {
        if (result.available) {
            // Auto-select direct upload and show minimal UI
            container.innerHTML = `
                <div class="upload-method-auto">
                    <h4>✅ Direct Upload Ready</h4>
                    <p>Files will be uploaded directly using your storage node</p>
                    <input type="hidden" name="upload-method" value="direct">
                    <button id="auto-upload-btn" class="btn btn-primary" onclick="startFinalUpload()">
                        Upload Video Now
                    </button>
                </div>
            `;
        } else {
            // Fallback to standard upload
            container.innerHTML = `
                <div class="upload-method-fallback">
                    <h4>⚠️ Using Standard Upload</h4>
                    <p>Direct upload not available: ${result.reason}</p>
                    <input type="hidden" name="upload-method" value="standard">
                    <button id="standard-upload-btn" class="btn btn-primary" onclick="startFinalUpload()">
                        Upload Video Now
                    </button>
                </div>
            `;
        }
    });
}

async function startFinalUpload() {
    const uploadMethod = document.querySelector('input[name="upload-method"]')?.value || 'direct';
    if (!uploadMethod) {
        showNotification('Upload method not determined', 'error');
        return;
    }
    
    addLog(`Starting ${uploadMethod} upload...`, 'info');
    
    // Hide upload method selection, show upload progress
    document.getElementById('upload-method-selection').style.display = 'none';
    document.getElementById('upload-logs-container').style.display = 'block';
    
    const uploadContainer = document.getElementById('upload-logs');
    const progressFill = document.getElementById('upload-progress-fill');
    const progressText = document.getElementById('upload-progress-text');
    
    uploadContainer.innerHTML = '';
    
    function addUploadLog(message, type = 'info') {
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry log-${type}`;
        logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        uploadContainer.appendChild(logEntry);
        uploadContainer.scrollTop = uploadContainer.scrollHeight;
    }
    
    try {
        let totalProgress = 0;
        let uploadedCount = 0;
        
        addUploadLog('Preparing files for upload...', 'info');
        progressFill.style.width = '5%';
        progressText.textContent = 'Preparing upload...';
        
        if (uploadMethod === 'direct') {
            // Direct upload via IPFS to storage node
            addUploadLog('Uploading to your storage node via IPFS...', 'info');
            
            // Upload IPFS-ready files and selected thumbnail
            const filesToUpload = new Map(ipfsReadyFiles);
            
            // Add selected thumbnail
            if (selectedThumbnail) {
                filesToUpload.set('poster.jpg', selectedThumbnail.file);
            }
            
            const fileCount = filesToUpload.size;
            
            for (const [filename, file] of filesToUpload) {
                addUploadLog(`Uploading ${filename}...`, 'info');
                try {
                    // Convert File to ArrayBuffer for IPFS upload
                    const buffer = await file.arrayBuffer();
                    const result = await window.api.invoke('ipfs:addFile', {
                        name: filename,
                        data: Array.from(new Uint8Array(buffer))
                    });
                    
                    if (result.success) {
                        uploadedCount++;
                        addUploadLog(`✓ ${filename} → IPFS CID: ${result.cid}`, 'success');
                    } else {
                        addUploadLog(`✗ Failed to upload ${filename}: ${result.error}`, 'error');
                    }
                } catch (error) {
                    addUploadLog(`✗ Error uploading ${filename}: ${error.message}`, 'error');
                }
                
                // Update progress
                totalProgress = Math.round((uploadedCount / fileCount) * 95) + 5;
                progressFill.style.width = totalProgress + '%';
                progressText.textContent = `Uploading... ${uploadedCount}/${fileCount} files`;
                
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            if (uploadedCount === fileCount) {
                addUploadLog('All files uploaded successfully!', 'success');
                addUploadLog('Your content is now available on the SPK Network', 'success');
            } else {
                addUploadLog(`Upload completed with errors: ${uploadedCount}/${fileCount} files uploaded`, 'warning');
            }
            
        } else {
            // Standard upload to SPK gateway
            addUploadLog('Preparing to upload to SPK Network gateway...', 'info');
            
            // Prepare files to upload (IPFS-ready files and selected thumbnail)
            const filesToUpload = new Map(ipfsReadyFiles);
            
            // Add selected thumbnail
            if (selectedThumbnail) {
                filesToUpload.set('poster.jpg', selectedThumbnail.file);
            }
            
            try {
                // Prepare file paths and metadata for upload
                const filePaths = [];
                const metadataArray = [];
                
                // Get the original video filename (without extension) for the master playlist
                const originalName = selectedVideo ? selectedVideo.name.replace(/\.[^/.]+$/, '') : 'video';
                const cleanName = originalName.substring(0, 32).replace(/,/g, '-');
                
                // Make sure we have the temp directory
                if (!currentTempDir) {
                    throw new Error('No temp directory available - transcoding may have failed');
                }
                
                // Add selected thumbnail first if we have one
                if (selectedThumbnail && selectedThumbnail.file) {
                    // For custom uploaded thumbnails, we need to save them first
                    let thumbnailPath;
                    if (selectedThumbnail.resolution === 'custom') {
                        // Save custom thumbnail to temp directory
                        const customThumbData = await selectedThumbnail.file.arrayBuffer();
                        const saveResult = await window.api.invoke('ffmpeg:saveFile', {
                            path: `${currentTempDir}/${cleanName}_poster.jpg`,
                            data: Array.from(new Uint8Array(customThumbData))
                        });
                        if (!saveResult.success) {
                            throw new Error('Failed to save custom thumbnail');
                        }
                        thumbnailPath = saveResult.path;
                    } else {
                        // Use the generated thumbnail path
                        thumbnailPath = transcodedFilePaths.get('thumbnail.jpg');
                    }
                    
                    if (thumbnailPath) {
                        filePaths.push({
                            path: thumbnailPath,
                            name: `${cleanName}_poster.jpg`,
                            type: 'image/jpeg'
                        });
                        metadataArray.push({
                            FileIndex: filePaths.length - 1,
                            name: cleanName + '_poster',
                            ext: 'jpg',
                            path: '/Videos',
                            labels: ['poster']
                        });
                    }
                }
                
                // Add all transcoded files using their paths
                let masterFileIndex = -1;
                for (const [filename, file] of ipfsReadyFiles) {
                    const filePath = transcodedFilePaths.get(filename);
                    if (!filePath) {
                        addUploadLog(`Warning: No path found for ${filename}`, 'warn');
                        continue;
                    }
                    
                    filePaths.push({
                        path: filePath,
                        name: filename,
                        type: file.type
                    });
                    const fileIndex = filePaths.length - 1;
                    
                    if (filename === 'master.m3u8') {
                        masterFileIndex = fileIndex;
                        // Master playlist gets full metadata
                        metadataArray.push({
                            FileIndex: fileIndex,
                            name: cleanName,
                            ext: 'm3u8',
                            path: '/Videos',
                            labels: ['video', 'hls'],
                            thumbnail: selectedThumbnail ? 0 : undefined // Reference to thumbnail index
                        });
                    } else {
                        // All other files (segments, resolution playlists) get minimal metadata
                        metadataArray.push({
                            FileIndex: fileIndex,
                            name: filename.replace(/\.[^/.]+$/, ''),
                            ext: filename.split('.').pop(),
                            path: '/Videos',
                            labels: []
                        });
                    }
                }
                
                addUploadLog(`Uploading ${filePaths.length} files to /Videos folder on SPK Network...`, 'info');
                progressFill.style.width = '20%';
                progressText.textContent = 'Uploading files...';
                
                // Set up progress listener
                const progressHandler = (event, progress) => {
                    const percent = 20 + (progress * 70);
                    progressFill.style.width = percent + '%';
                    progressText.textContent = `Uploading... ${Math.round(progress * 100)}%`;
                };
                window.api.on('spk:upload-progress', progressHandler);
                
                try {
                    // Pass file paths instead of file data - backend will read from disk
                    const uploadResult = await window.api.spk.uploadFromPaths({
                        filePaths: filePaths,
                        metaData: metadataArray,
                        duration: 30,
                        tempDir: currentTempDir
                    });
                    
                    // Remove progress listener
                    window.api.off('spk:upload-progress', progressHandler);
                    
                    if (!uploadResult.success) {
                        throw new Error('Upload failed: ' + uploadResult.error);
                    }
                    
                    // Log results based on what spk-js returns
                    if (uploadResult.results) {
                        // Batch upload result
                        addUploadLog(`Upload completed! Contract ID: ${uploadResult.contractId}`, 'success');
                        addUploadLog(`Total BROCA cost: ${uploadResult.totalBrocaCost}`, 'info');
                        
                        for (let i = 0; i < uploadResult.results.length; i++) {
                            const result = uploadResult.results[i];
                            const fileName = filesData[i]?.name || 'File';
                            addUploadLog(`✓ ${fileName} → ${result.url}`, 'success');
                        }
                    } else if (uploadResult.url) {
                        // Single file result
                        addUploadLog(`✓ Upload completed → ${uploadResult.url}`, 'success');
                    }
                    
                    addUploadLog('All files uploaded to SPK Network!', 'success');
                    
                    // Clean up temp directory after successful upload
                    if (currentTempDir) {
                        addUploadLog('Cleaning up temporary files...', 'info');
                        const cleanupResult = await window.api.invoke('ffmpeg:cleanupTempDir', currentTempDir);
                        if (!cleanupResult.success) {
                            addUploadLog(`Warning: Failed to cleanup temp directory: ${cleanupResult.error}`, 'warn');
                        }
                    }
                    
                } catch (error) {
                    // Remove progress listener on error too
                    window.api.off('spk:upload-progress', progressHandler);
                    addUploadLog(`Upload failed: ${error.message}`, 'error');
                    throw error;
                }
                
            } catch (error) {
                addUploadLog(`Failed to create storage contract: ${error.message}`, 'error');
                throw error;
            }
        }
        
        progressFill.style.width = '100%';
        progressText.textContent = 'Upload complete!';
        showNotification('Video uploaded successfully!', 'success');
        
        // Show completion actions
        setTimeout(() => {
            document.getElementById('upload-completion-actions').style.display = 'block';
        }, 1000);
        
    } catch (error) {
        addUploadLog(`Upload failed: ${error.message}`, 'error');
        showNotification('Upload failed: ' + error.message, 'error');
    }
}

function resetVideoUpload() {
    // Hide all panels
    document.getElementById('upload-progress').style.display = 'none';
    document.getElementById('video-preview').style.display = 'none';
    document.getElementById('upload-stage').style.display = 'none';
    document.getElementById('video-info').style.display = 'none';
    document.getElementById('upload-options').style.display = 'none';
    
    // Clear video selection
    document.getElementById('video-input').value = '';
    selectedVideo = null;
    
    // Clean up resources
    if (hlsPlayer) {
        hlsPlayer.destroy();
        hlsPlayer = null;
    }
    
    generatedFiles.clear();
    currentTranscodingSession = null;
    
    addLog('Video upload process reset', 'info');
}

// Make resetVideoUpload available globally
window.resetVideoUpload = resetVideoUpload;

// Add more resolutions function
function addMoreResolutions() {
    // TODO: Show modal to add more resolutions and re-transcode
    showNotification('Add more resolutions feature coming soon!', 'info');
}
window.addMoreResolutions = addMoreResolutions;

// Toggle file list visibility
function toggleFileList() {
    const header = document.querySelector('.file-info .collapsible-header');
    const list = document.getElementById('generated-files-list');
    
    header.classList.toggle('expanded');
    list.classList.toggle('collapsed');
}
window.toggleFileList = toggleFileList;

// Toggle M3U8 content visibility
function toggleM3U8Content() {
    const header = document.querySelector('.m3u8-content .collapsible-header');
    const viewer = document.getElementById('playlist-viewer');
    
    header.classList.toggle('expanded');
    viewer.classList.toggle('collapsed');
}
window.toggleM3U8Content = toggleM3U8Content;

// Show selected playlist content
async function showSelectedPlaylist() {
    const selector = document.getElementById('playlist-selector');
    const contentEl = document.getElementById('m3u8-content');
    
    if (!selector || !contentEl) return;
    
    const selectedFile = selector.value;
    const playlistFile = ipfsReadyFiles.get(selectedFile);
    
    if (playlistFile) {
        const content = await playlistFile.text();
        contentEl.textContent = content;
        addLog(`Showing IPFS-ready ${selectedFile} with CIDs`, 'info');
    }
}
window.showSelectedPlaylist = showSelectedPlaylist;

// Update setupUploadMethodSelection to use saved choice from preview
function setupUploadMethodSelection() {
    const container = document.getElementById('upload-method-selection');
    
    // Get the selected method from preview
    const previewMethod = document.querySelector('input[name="preview-upload-method"]:checked')?.value || 'direct';
    
    // Check direct upload availability
    checkDirectUploadAvailability().then(result => {
        const directUploadOption = result.available ? `
            <label class="upload-method">
                <input type="radio" name="upload-method" value="direct" ${previewMethod === 'direct' ? 'checked' : ''}>
                <strong>Direct Upload to Storage Node</strong>
                <small>Upload directly to your storage node and earn rewards</small>
            </label>
        ` : `
            <label class="upload-method disabled">
                <input type="radio" name="upload-method" value="direct" disabled>
                <strong>Direct Upload to Storage Node</strong>
                <small>Prerequisites not met: ${result.reason}</small>
            </label>
        `;
        
        container.innerHTML = `
            <h4>Confirm Upload Method</h4>
            ${directUploadOption}
            <label class="upload-method">
                <input type="radio" name="upload-method" value="standard" ${previewMethod === 'gateway' || !result.available ? 'checked' : ''}>
                <strong>Standard Upload to SPK Network</strong>
                <small>Upload to public SPK storage gateway</small>
            </label>
        `;
    });
}

/**
 * Check if direct upload to storage node is available
 */
async function checkDirectUploadAvailability() {
    try {
        // Use the same getStatus call that the renderer uses
        const status = await window.api.storage.getStatus();
        console.log('[Direct Upload] Storage status:', status);
        
        return {
            available: status && status.running && status.registered,
            reason: !status ? 'Storage node not initialized' :
                   !status.running ? 'Storage node not running' :
                   !status.registered ? 'Storage node not registered' :
                   'Unknown',
            status: status
        };
    } catch (error) {
        console.warn('[Video Processing] Direct upload not available:', error);
        return {
            available: false,
            reason: `Error: ${error.message}`,
            error: error.message
        };
    }
}

// Show dialog to get upload options from user
async function showUploadOptionsDialog() {
    // Get default video name from the original file
    const originalFileName = document.querySelector('#video-input')?.files?.[0]?.name || 'video.mp4';
    const defaultVideoName = originalFileName.replace(/\.[^/.]+$/, ''); // Remove extension
    
    return new Promise((resolve) => {
        const dialog = document.createElement('div');
        dialog.className = 'modal-overlay';
        dialog.innerHTML = `
            <div class="modal-content" style="max-width: 500px;">
                <h3>Upload Settings</h3>
                
                <div class="form-group">
                    <label for="video-name-input">Video Name:</label>
                    <input type="text" id="video-name-input" class="form-control" 
                           value="${defaultVideoName}" 
                           placeholder="Enter video name">
                    <small>The name that will appear in your SPK library</small>
                </div>
                
                <div class="form-group">
                    <label for="folder-path-input">Folder Path:</label>
                    <select id="folder-path-input" class="form-control">
                        <option value="Videos" selected>Videos (Default)</option>
                        <option value="Videos/Movies">Videos/Movies</option>
                        <option value="Videos/Tutorials">Videos/Tutorials</option>
                        <option value="Videos/Personal">Videos/Personal</option>
                        <option value="Documents">Documents</option>
                        <option value="custom">Custom Path...</option>
                    </select>
                    <input type="text" id="custom-path-input" class="form-control" 
                           style="display: none; margin-top: 10px;" 
                           placeholder="Enter custom path (e.g., MyFolder/Subfolder)">
                </div>
                
                <div class="form-group">
                    <label for="description-input">Description (optional):</label>
                    <textarea id="description-input" class="form-control" rows="3" 
                              placeholder="Enter video description"></textarea>
                </div>
                
                <div class="form-group">
                    <label for="labels-input">Tags/Labels (optional):</label>
                    <input type="text" id="labels-input" class="form-control" 
                           placeholder="Enter tags separated by commas (e.g., tutorial, programming, javascript)">
                </div>
                
                <div class="form-group">
                    <label for="license-input">License (optional):</label>
                    <select id="license-input" class="form-control">
                        <option value="">No license specified</option>
                        <option value="CC0">CC0 - Public Domain</option>
                        <option value="CC-BY">CC-BY - Attribution</option>
                        <option value="CC-BY-SA">CC-BY-SA - Attribution ShareAlike</option>
                        <option value="CC-BY-NC">CC-BY-NC - Attribution NonCommercial</option>
                        <option value="CC-BY-NC-SA">CC-BY-NC-SA - Attribution NonCommercial ShareAlike</option>
                        <option value="All Rights Reserved">All Rights Reserved</option>
                    </select>
                </div>
                
                <div class="button-group">
                    <button class="btn btn-secondary" onclick="cancelUploadDialog()">Cancel</button>
                    <button class="btn btn-primary" onclick="confirmUploadDialog()">Upload</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(dialog);
        
        // Handle folder path selection
        const folderSelect = document.getElementById('folder-path-input');
        const customPathInput = document.getElementById('custom-path-input');
        
        folderSelect.addEventListener('change', (e) => {
            if (e.target.value === 'custom') {
                customPathInput.style.display = 'block';
                customPathInput.focus();
            } else {
                customPathInput.style.display = 'none';
            }
        });
        
        // Store the resolve function globally so buttons can access it
        window._uploadDialogResolve = resolve;
        window._uploadDialog = dialog;
        
        // Define button handlers
        window.cancelUploadDialog = () => {
            document.body.removeChild(dialog);
            resolve(null);
        };
        
        window.confirmUploadDialog = () => {
            const videoName = document.getElementById('video-name-input').value.trim();
            const folderPath = folderSelect.value === 'custom' 
                ? customPathInput.value.trim() 
                : folderSelect.value;
            const description = document.getElementById('description-input').value.trim();
            const labels = document.getElementById('labels-input').value.trim();
            const license = document.getElementById('license-input').value;
            
            if (!videoName) {
                alert('Please enter a video name');
                return;
            }
            
            if (folderSelect.value === 'custom' && !customPathInput.value.trim()) {
                alert('Please enter a custom folder path');
                return;
            }
            
            document.body.removeChild(dialog);
            resolve({
                videoName,
                folderPath: folderPath || 'Videos',
                description,
                labels,
                license
            });
        };
        
        // Focus on the video name input
        setTimeout(() => {
            document.getElementById('video-name-input').select();
        }, 100);
    });
}

// ONE-CLICK Direct Upload Function - bypasses all selection screens
async function startDirectUpload() {
    console.log('[Direct Upload] Starting one-click direct upload...');
    
    // First show a dialog to get video name and folder path
    const uploadOptions = await showUploadOptionsDialog();
    if (!uploadOptions) {
        // User cancelled
        return;
    }
    
    // Hide preview, show upload progress immediately
    document.getElementById('video-preview').style.display = 'none';
    document.getElementById('upload-stage').style.display = 'block';
    document.getElementById('upload-logs-container').style.display = 'block';
    
    const progressFill = document.getElementById('upload-progress-fill');
    const progressText = document.getElementById('upload-progress-text');
    const uploadContainer = document.getElementById('upload-logs');
    
    uploadContainer.innerHTML = '';
    
    function addUploadLog(message, type = 'info') {
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry log-${type}`;
        logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        uploadContainer.appendChild(logEntry);
        uploadContainer.scrollTop = uploadContainer.scrollHeight;
    }
    
    try {
        addUploadLog('Starting direct upload to SPK Network...', 'info');
        progressFill.style.width = '10%';
        progressText.textContent = 'Preparing files...';
        
        // Prepare file data for upload
        const filesToUpload = [];
        for (const [filename, fileData] of ipfsReadyFiles) {
            // fileData is a File object, so we need to read it as buffer
            const buffer = await fileData.arrayBuffer();
            filesToUpload.push({
                name: filename,
                buffer: buffer,
                size: fileData.size,
                type: fileData.type || 'application/octet-stream'
            });
        }
        
        // Add selected thumbnail if available
        if (selectedThumbnail && selectedThumbnail.buffer) {
            filesToUpload.push({
                name: 'thumbnail.jpg',
                buffer: selectedThumbnail.buffer,
                size: selectedThumbnail.buffer.length,
                type: 'image/jpeg'
            });
        }
        
        addUploadLog(`Uploading ${filesToUpload.length} files...`, 'info');
        progressFill.style.width = '20%';
        progressText.textContent = 'Broadcasting transaction...';
        
        // Use the batch upload handler with direct method
        const result = await window.api.invoke('upload:batch', {
            files: filesToUpload,
            options: {
                uploadMethod: 'direct',
                videoName: uploadOptions.videoName,
                folderPath: uploadOptions.folderPath,
                description: uploadOptions.description || '',
                license: uploadOptions.license || '',
                labels: uploadOptions.labels || ''
            }
        });
        
        if (result.success) {
            addUploadLog('✅ Upload successful!', 'success');
            progressFill.style.width = '100%';
            progressText.textContent = 'Upload complete!';
            
            // Show completion actions
            document.getElementById('upload-completion-actions').style.display = 'block';
            
            if (result.data.masterUrl) {
                addUploadLog(`Master playlist: ${result.data.masterUrl}`, 'success');
            }
            
            addUploadLog(`Transaction ID: ${result.data.transactionId || 'Processing...'}`, 'info');
            
        } else {
            throw new Error(result.error || 'Upload failed');
        }
        
    } catch (error) {
        console.error('[Direct Upload] Error:', error);
        addUploadLog(`❌ Upload failed: ${error.message}`, 'error');
        progressText.textContent = 'Upload failed';
        
        // Add retry option
        const retryBtn = document.createElement('button');
        retryBtn.textContent = 'Retry Upload';
        retryBtn.className = 'btn btn-primary';
        retryBtn.onclick = startDirectUpload;
        uploadContainer.appendChild(retryBtn);
    }
}

// Export key functions to global scope for use from other files
window.transcodeToHLS = transcodeToHLS;
window.showVideoPreview = showVideoPreview;
window.proceedToUpload = proceedToUpload;
window.startDirectUpload = startDirectUpload; // NEW: One-click upload
window.retranscode = retranscode;
window.backToPreview = backToPreview;
window.selectThumbnail = selectThumbnail;
window.checkDirectUploadAvailability = checkDirectUploadAvailability;

console.log('[Video Processing Native] Functions exported successfully:', {
    transcodeToHLS: typeof window.transcodeToHLS,
    showVideoPreview: typeof window.showVideoPreview,
    proceedToUpload: typeof window.proceedToUpload
});