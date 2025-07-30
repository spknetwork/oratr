// Dead simple SPK-JS upload
window.startFinalUpload = async function() {
    console.log('=== startFinalUpload CALLED ===');
    const uploadMethod = document.querySelector('input[name="upload-method"]:checked')?.value;
    if (!uploadMethod) {
        showNotification('Please select an upload method', 'error');
        return;
    }
    
    // Check if we selected preview upload method
    const previewMethod = document.querySelector('input[name="preview-upload-method"]:checked')?.value;
    const actualUploadMethod = previewMethod || uploadMethod;
    
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
        addUploadLog('Starting SPK upload...', 'info');
        
        // Collect all files into an array
        const files = [];
        for (const [filename, file] of ipfsReadyFiles) {
            files.push(file);
        }
        if (selectedThumbnail) {
            files.push(selectedThumbnail.file);
        }
        
        addUploadLog(`Uploading ${files.length} files to SPK Network...`, 'info');
        
        // Log file details before sending
        for (const file of files) {
            addUploadLog(`File: ${file.name} (${file.size} bytes, type: ${file.type})`, 'info');
        }
        
        // Just call the upload endpoint with our files
        const filesData = await Promise.all(files.map(async f => {
            const buffer = f.arrayBuffer ? await f.arrayBuffer() : f;
            addUploadLog(`Converted ${f.name} to buffer (${buffer.byteLength || buffer.length} bytes)`, 'info');
            return {
                name: f.name,
                size: f.size,
                type: f.type,
                buffer: buffer
            };
        }));
        
        addUploadLog(`Using ${actualUploadMethod} upload method...`, 'info');
        const result = await window.api.invoke('upload:batch', {
            files: filesData,
            options: {
                duration: 30, // days
                metadata: {
                    title: window.selectedVideo?.name || 'Video',
                    type: 'video/hls'
                },
                uploadMethod: actualUploadMethod
            }
        });
        
        if (result.success) {
            addUploadLog('Upload completed successfully!', 'success');
            addUploadLog(`Contract ID: ${result.data.contractId}`, 'success');
            addUploadLog(`Master playlist: ${result.data.masterUrl}`, 'success');
            
            progressFill.style.width = '100%';
            progressText.textContent = 'Upload complete!';
        } else {
            throw new Error(result.error);
        }
        
    } catch (error) {
        addUploadLog(`Upload failed: ${error.message}`, 'error');
        showNotification('Upload failed: ' + error.message, 'error');
    }
};