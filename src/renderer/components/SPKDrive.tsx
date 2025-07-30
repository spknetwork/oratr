/**
 * SPK Drive Component for SPK Desktop
 * 
 * React component that integrates SPK Drive functionality
 * with drag-and-drop file management
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SPKDrive, SPKFile, SPKFolder } from 'spk-js/drive';
import './SPKDrive.css';

interface SPKDriveProps {
  account: any; // SPK Account instance
  onFileUpload?: (files: FileList, folder: string) => void;
  onFileSelected?: (files: string[]) => void;
  onError?: (error: Error) => void;
}

interface ContextMenu {
  show: boolean;
  x: number;
  y: number;
  type: 'file' | 'folder' | 'background';
  target: SPKFile | SPKFolder | null;
}

const SPKDriveComponent: React.FC<SPKDriveProps> = ({ 
  account, 
  onFileUpload,
  onFileSelected,
  onError 
}) => {
  // State
  const [drive, setDrive] = useState<SPKDrive | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentPath, setCurrentPath] = useState('');
  const [files, setFiles] = useState<SPKFile[]>([]);
  const [folders, setFolders] = useState<SPKFolder[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'date'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [isDragging, setIsDragging] = useState(false);
  const [storageStats, setStorageStats] = useState<any>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu>({
    show: false,
    x: 0,
    y: 0,
    type: 'background',
    target: null
  });

  const dragCounter = useRef(0);
  const fileAreaRef = useRef<HTMLDivElement>(null);

  // Initialize drive
  useEffect(() => {
    const initDrive = async () => {
      try {
        setLoading(true);
        const driveInstance = new SPKDrive(account);
        
        // Set up event listeners
        driveInstance.on('driveLoaded', (stats) => {
          console.log('Drive loaded:', stats);
          updateFileList(driveInstance);
        });
        
        driveInstance.on('error', (error) => {
          console.error('Drive error:', error);
          onError?.(error);
        });
        
        driveInstance.on('fileMoved', () => {
          updateFileList(driveInstance);
        });
        
        driveInstance.on('fileDeleted', () => {
          updateFileList(driveInstance);
        });
        
        driveInstance.on('folderCreated', () => {
          updateFileList(driveInstance);
        });

        await driveInstance.loadDrive();
        setDrive(driveInstance);
        updateFileList(driveInstance);
      } catch (error) {
        console.error('Failed to initialize drive:', error);
        onError?.(error as Error);
      } finally {
        setLoading(false);
      }
    };

    if (account) {
      initDrive();
    }

    return () => {
      if (drive) {
        drive.removeAllListeners();
      }
    };
  }, [account]);

  // Update file list
  const updateFileList = useCallback((driveInstance: SPKDrive) => {
    const fileList = searchQuery 
      ? driveInstance.searchFiles(searchQuery, { folder: currentPath })
      : driveInstance.getFiles(currentPath);
    
    // Sort files
    fileList.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'name':
          comparison = (a.metadata?.name || '').localeCompare(b.metadata?.name || '');
          break;
        case 'size':
          comparison = a.s - b.s;
          break;
        case 'date':
          comparison = (a.t || 0) - (b.t || 0);
          break;
      }
      return sortDir === 'asc' ? comparison : -comparison;
    });
    
    setFiles(fileList);
    setFolders(driveInstance.getSubfolders(currentPath));
    setStorageStats(driveInstance.getStorageStats());
  }, [currentPath, searchQuery, sortBy, sortDir]);

  // Navigation
  const navigateTo = useCallback((path: string) => {
    setCurrentPath(path);
    setSelectedFiles(new Set());
    setSelectedFolders(new Set());
    if (drive) {
      updateFileList(drive);
    }
  }, [drive, updateFileList]);

  // File/Folder selection
  const handleFileClick = useCallback((event: React.MouseEvent, file: SPKFile) => {
    event.preventDefault();
    
    if (event.ctrlKey || event.metaKey) {
      // Multi-select
      const newSelection = new Set(selectedFiles);
      if (newSelection.has(file.f)) {
        newSelection.delete(file.f);
      } else {
        newSelection.add(file.f);
      }
      setSelectedFiles(newSelection);
    } else {
      // Single select
      setSelectedFiles(new Set([file.f]));
      setSelectedFolders(new Set());
    }
    
    onFileSelected?.(Array.from(selectedFiles));
  }, [selectedFiles, onFileSelected]);

  const handleFolderClick = useCallback((event: React.MouseEvent, folder: SPKFolder) => {
    event.preventDefault();
    
    if (event.detail === 2) {
      // Double click - navigate
      navigateTo(folder.path);
    } else {
      // Single click - select
      setSelectedFiles(new Set());
      setSelectedFolders(new Set([folder.path]));
    }
  }, [navigateTo]);

  // Drag and Drop
  const handleDragStart = useCallback((event: React.DragEvent, item: SPKFile | SPKFolder, type: 'file' | 'folder') => {
    const data = {
      type,
      items: [item]
    };
    
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/json', JSON.stringify(data));
  }, []);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDragEnter = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    dragCounter.current++;
    if (dragCounter.current === 1) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(async (event: React.DragEvent, targetFolder?: string) => {
    event.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);
    
    const folder = targetFolder ?? currentPath;
    
    // Handle external files
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      onFileUpload?.(event.dataTransfer.files, folder);
      return;
    }
    
    // Handle internal drag
    try {
      const data = JSON.parse(event.dataTransfer.getData('application/json'));
      if (data.type === 'file' && drive) {
        for (const file of data.items) {
          await drive.moveFile(file.f, folder);
        }
      }
    } catch (error) {
      console.error('Drop error:', error);
    }
  }, [currentPath, drive, onFileUpload]);

  // Context menu
  const showContextMenu = useCallback((event: React.MouseEvent, type: 'file' | 'folder' | 'background', target?: SPKFile | SPKFolder) => {
    event.preventDefault();
    setContextMenu({
      show: true,
      x: event.clientX,
      y: event.clientY,
      type,
      target: target || null
    });
  }, []);

  const hideContextMenu = useCallback(() => {
    setContextMenu(prev => ({ ...prev, show: false }));
  }, []);

  // Actions
  const createNewFolder = useCallback(async () => {
    const name = prompt('Enter folder name:');
    if (name && drive) {
      const path = currentPath ? `${currentPath}/${name}` : name;
      try {
        await drive.createFolder(path);
        updateFileList(drive);
      } catch (error) {
        console.error('Failed to create folder:', error);
        onError?.(error as Error);
      }
    }
  }, [currentPath, drive, updateFileList, onError]);

  const deleteSelected = useCallback(async () => {
    if (!drive || selectedFiles.size === 0) return;
    
    if (confirm(`Delete ${selectedFiles.size} file(s)?`)) {
      for (const cid of selectedFiles) {
        await drive.deleteFile(cid);
      }
      setSelectedFiles(new Set());
      updateFileList(drive);
    }
  }, [drive, selectedFiles, updateFileList]);

  const refreshDrive = useCallback(async () => {
    if (!drive) return;
    
    setLoading(true);
    try {
      await drive.loadDrive();
      updateFileList(drive);
    } catch (error) {
      console.error('Failed to refresh drive:', error);
      onError?.(error as Error);
    } finally {
      setLoading(false);
    }
  }, [drive, updateFileList, onError]);

  // Format bytes
  const formatBytes = (bytes: number): string => {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  };

  // Breadcrumb
  const breadcrumb = currentPath.split('/').filter(Boolean);
  const storagePercentage = storageStats 
    ? (storageStats.usedSize / storageStats.totalSize) * 100
    : 0;

  useEffect(() => {
    document.addEventListener('click', hideContextMenu);
    return () => {
      document.removeEventListener('click', hideContextMenu);
    };
  }, [hideContextMenu]);

  if (loading) {
    return (
      <div className="spk-drive-loading">
        <div className="spinner-border" role="status">
          <span className="sr-only">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`spk-drive ${isDragging ? 'dragging' : ''}`}>
      {/* Header */}
      <div className="spk-drive-header">
        {/* Search */}
        <div className="search-container">
          <i className="fas fa-search"></i>
          <input
            type="search"
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Storage Info */}
        <div className="storage-info">
          <small>{storageStats?.fileCount || 0} files</small>
          <div className="storage-bar">
            <div 
              className="storage-used"
              style={{ width: `${storagePercentage}%` }}
              data-percentage={`${storagePercentage.toFixed(1)}%`}
            />
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="spk-drive-toolbar">
        {/* Breadcrumb */}
        <nav className="breadcrumb">
          <span onClick={() => navigateTo('')}>My Drive</span>
          {breadcrumb.map((part, index) => (
            <React.Fragment key={index}>
              <span className="separator">/</span>
              <span onClick={() => navigateTo(breadcrumb.slice(0, index + 1).join('/'))}>
                {part}
              </span>
            </React.Fragment>
          ))}
        </nav>

        {/* Actions */}
        <div className="actions">
          <button onClick={createNewFolder} className="btn-new-folder">
            <i className="fas fa-folder-plus"></i> New Folder
          </button>
          <button onClick={refreshDrive} className="btn-refresh">
            <i className="fas fa-sync"></i>
          </button>
          <div className="view-toggle">
            <button 
              className={viewMode === 'grid' ? 'active' : ''}
              onClick={() => setViewMode('grid')}
            >
              <i className="fas fa-th"></i>
            </button>
            <button 
              className={viewMode === 'list' ? 'active' : ''}
              onClick={() => setViewMode('list')}
            >
              <i className="fas fa-list"></i>
            </button>
          </div>
        </div>
      </div>

      {/* File Area */}
      <div 
        ref={fileAreaRef}
        className="spk-drive-files"
        onDrop={(e) => handleDrop(e)}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onContextMenu={(e) => showContextMenu(e, 'background')}
      >
        {viewMode === 'grid' ? (
          <div className="file-grid">
            {/* Folders */}
            {folders.map(folder => (
              <div
                key={folder.path}
                className={`file-item folder ${selectedFolders.has(folder.path) ? 'selected' : ''}`}
                draggable
                onDragStart={(e) => handleDragStart(e, folder, 'folder')}
                onClick={(e) => handleFolderClick(e, folder)}
                onContextMenu={(e) => showContextMenu(e, 'folder', folder)}
              >
                <i className="fas fa-folder"></i>
                <span className="file-name">{folder.name}</span>
              </div>
            ))}

            {/* Files */}
            {files.map(file => (
              <div
                key={file.f}
                className={`file-item ${selectedFiles.has(file.f) ? 'selected' : ''}`}
                draggable
                onDragStart={(e) => handleDragStart(e, file, 'file')}
                onClick={(e) => handleFileClick(e, file)}
                onContextMenu={(e) => showContextMenu(e, 'file', file)}
              >
                <div className="file-icon">
                  {file.metadata?.thumb_data ? (
                    <img src={file.metadata.thumb_data} alt={file.metadata.name} />
                  ) : (
                    <i className="fas fa-file"></i>
                  )}
                </div>
                <span className="file-name">{file.metadata?.name || file.f}</span>
                <span className="file-size">{formatBytes(file.s)}</span>
              </div>
            ))}
          </div>
        ) : (
          <table className="file-list">
            <thead>
              <tr>
                <th>Name</th>
                <th>Size</th>
                <th>Type</th>
                <th>Modified</th>
              </tr>
            </thead>
            <tbody>
              {/* Folders */}
              {folders.map(folder => (
                <tr
                  key={folder.path}
                  className={`folder-row ${selectedFolders.has(folder.path) ? 'selected' : ''}`}
                  onClick={(e) => handleFolderClick(e, folder)}
                  onContextMenu={(e) => showContextMenu(e, 'folder', folder)}
                >
                  <td>
                    <i className="fas fa-folder"></i>
                    {folder.name}
                  </td>
                  <td>-</td>
                  <td>Folder</td>
                  <td>{new Date(folder.modified).toLocaleString()}</td>
                </tr>
              ))}

              {/* Files */}
              {files.map(file => (
                <tr
                  key={file.f}
                  className={selectedFiles.has(file.f) ? 'selected' : ''}
                  onClick={(e) => handleFileClick(e, file)}
                  onContextMenu={(e) => showContextMenu(e, 'file', file)}
                >
                  <td>
                    <i className="fas fa-file"></i>
                    {file.metadata?.name || file.f}
                  </td>
                  <td>{formatBytes(file.s)}</td>
                  <td>{file.metadata?.type || 'Unknown'}</td>
                  <td>{file.t ? new Date(file.t * 1000).toLocaleString() : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Empty State */}
        {folders.length === 0 && files.length === 0 && (
          <div className="empty-state">
            <i className="fas fa-folder-open"></i>
            <p>{searchQuery ? 'No files found' : 'This folder is empty'}</p>
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu.show && (
        <div 
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.type === 'file' && (
            <>
              <button onClick={() => console.log('Open file')}>
                <i className="fas fa-external-link-alt"></i> Open
              </button>
              <button onClick={deleteSelected}>
                <i className="fas fa-trash"></i> Delete
              </button>
            </>
          )}
          
          {contextMenu.type === 'folder' && (
            <button onClick={() => navigateTo((contextMenu.target as SPKFolder).path)}>
              <i className="fas fa-folder-open"></i> Open
            </button>
          )}
          
          {contextMenu.type === 'background' && (
            <>
              <button onClick={createNewFolder}>
                <i className="fas fa-folder-plus"></i> New Folder
              </button>
              <button onClick={refreshDrive}>
                <i className="fas fa-sync"></i> Refresh
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default SPKDriveComponent;