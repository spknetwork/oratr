/**
 * Simplified upload using spk-js integration
 */

async function uploadToSPK(files, options = {}) {
    const uploadContainer = document.getElementById('upload-logs');
    const progressFill = document.getElementById('upload-progress-fill');
    const progressText = document.getElementById('upload-progress-text');
    
    function addUploadLog(message, type = 'info') {
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry log-${type}`;
        logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        uploadContainer.appendChild(logEntry);
        uploadContainer.scrollTop = uploadContainer.scrollHeight;
    }
    
    try {
        addUploadLog('Starting upload to SPK Network...', 'info');
        
        // Check for active account
        const accountCheck = await window.api.invoke('account:getActive');
        if (!accountCheck.success || !accountCheck.username) {
            throw new Error('Please login to your SPK account first');
        }
        
        addUploadLog(`Using account: @${accountCheck.username}`, 'info');
        
        // Convert files Map to array if needed
        let fileArray = files;
        if (files instanceof Map) {
            fileArray = Array.from(files.values());
        }
        
        // Get video file or assume it's a processed upload
        const videoFile = fileArray.find(f => 
            f.name.includes('.mp4') || 
            f.type?.startsWith('video/')
        );
        
        if (videoFile && videoFile.path) {
            // Raw video file - use video upload service
            addUploadLog('Processing video file...', 'info');
            
            const result = await window.api.invoke('upload:video', {
                filePath: videoFile.path,
                options: {
                    generateThumbnail: true,
                    resolutions: options.resolutions || ['1080p', '720p', '480p'],
                    contract: {
                        duration: options.duration || 30,
                        autoRenew: options.autoRenew || false
                    },
                    metadata: {
                        path: 'Videos',
                        title: options.title || videoFile.name,
                        tags: options.tags || [],
                        labels: options.labels || '',
                        license: options.license || 'CC0'
                    }
                }
            });
            
            if (!result.success) {
                throw new Error(result.error);
            }
            
            // Listen for progress events
            window.api.on('upload:progress', (progress) => {
                progressFill.style.width = `${progress.progress}%`;
                progressText.textContent = progress.message;
                addUploadLog(progress.message, 'info');
            });
            
            addUploadLog('Upload completed successfully!', 'success');
            addUploadLog(`View at: ${result.data.master.url}`, 'success');
            
            return result;
            
        } else {
            // Pre-processed files - direct upload
            addUploadLog('Uploading pre-processed files...', 'info');
            
            // For now, use IPFS direct upload
            let uploadedCount = 0;
            const results = {};
            
            for (let i = 0; i < fileArray.length; i++) {
                const file = fileArray[i];
                addUploadLog(`Uploading ${file.name}...`, 'info');
                
                try {
                    const buffer = await file.arrayBuffer();
                    const uploadResult = await window.api.invoke('ipfs:addFile', {
                        name: file.name,
                        data: Array.from(new Uint8Array(buffer))
                    });
                    
                    if (uploadResult.success) {
                        results[file.name] = uploadResult.cid;
                        uploadedCount++;
                        addUploadLog(`✓ ${file.name} → ${uploadResult.cid}`, 'success');
                    } else {
                        addUploadLog(`✗ Failed: ${uploadResult.error}`, 'error');
                    }
                    
                    // Update progress
                    const progress = Math.round((uploadedCount / fileArray.length) * 100);
                    progressFill.style.width = `${progress}%`;
                    progressText.textContent = `Uploading... ${uploadedCount}/${fileArray.length} files`;
                    
                } catch (error) {
                    addUploadLog(`✗ Error: ${error.message}`, 'error');
                }
            }
            
            if (uploadedCount === fileArray.length) {
                addUploadLog('All files uploaded successfully!', 'success');
                
                const masterCid = results['master.m3u8'];
                if (masterCid) {
                    addUploadLog(`Master playlist: https://ipfs.dlux.io/ipfs/${masterCid}`, 'success');
                }
            }
            
            return {
                success: uploadedCount === fileArray.length,
                data: results
            };
        }
        
    } catch (error) {
        addUploadLog(`Error: ${error.message}`, 'error');
        return {
            success: false,
            error: error.message
        };
    }
}

// Replace the old startFinalUpload function
window.startFinalUpload = async function() {
    const uploadMethod = document.querySelector('input[name="upload-method"]:checked')?.value;
    if (!uploadMethod) {
        showNotification('Please select an upload method', 'error');
        return;
    }
    
    // Hide upload method selection, show upload progress
    document.getElementById('upload-method-selection').style.display = 'none';
    document.getElementById('upload-logs-container').style.display = 'block';
    
    // Clear logs
    document.getElementById('upload-logs').innerHTML = '';
    
    // Get files to upload
    const filesToUpload = new Map(ipfsReadyFiles);
    if (selectedThumbnail) {
        filesToUpload.set('poster.jpg', selectedThumbnail.file);
    }
    
    // Upload based on method
    if (uploadMethod === 'direct') {
        // Direct IPFS upload to local node
        await uploadToSPK(filesToUpload, {
            direct: true,
            title: originalFileName || 'Untitled Video'
        });
    } else {
        // Standard SPK network upload
        await uploadToSPK(filesToUpload, {
            title: originalFileName || 'Untitled Video',
            duration: 30 // days
        });
    }
};