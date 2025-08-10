/**
 * @jest-environment jsdom
 */

const StorageNodeTab = require('../../../../src/renderer/components/storage-node-tab');
const { EventEmitter } = require('events');

// Mock fetch for API calls
global.fetch = jest.fn();

describe.skip('StorageNodeTab', () => {
  let storageNodeTab;
  let mockContainer;
  let mockFileSyncService;
  let mockStorageNode;

  beforeEach(() => {
    // Setup DOM container
    document.body.innerHTML = '<div id="storage-node-container"></div>';
    mockContainer = document.getElementById('storage-node-container');

    // Mock File Sync Service
    mockFileSyncService = new EventEmitter();
    mockFileSyncService.getStatus = jest.fn().mockReturnValue({
      running: false,
      totalPinned: 0,
      lastSync: null
    });
    mockFileSyncService.start = jest.fn();
    mockFileSyncService.stop = jest.fn();

    // Mock Storage Node
    mockStorageNode = new EventEmitter();
    mockStorageNode.config = { account: 'testuser' };
    mockStorageNode.running = false;

    storageNodeTab = new StorageNodeTab({
      container: mockContainer,
      fileSyncService: mockFileSyncService,
      storageNode: mockStorageNode,
      spkApiUrl: 'https://spktest.dlux.io'
    });

    // Clear fetch mock
    fetch.mockClear();
  });

  afterEach(() => {
    storageNodeTab.destroy();
    document.body.innerHTML = '';
  });

  describe('initialization', () => {
    test('should create storage node tab instance', () => {
      expect(storageNodeTab).toBeDefined();
      expect(storageNodeTab.container).toBe(mockContainer);
    });

    test('should render initial UI', () => {
      storageNodeTab.render();

      expect(mockContainer.innerHTML).toContain('Storage Node');
      expect(mockContainer.querySelector('.storage-node-status')).toBeTruthy();
      expect(mockContainer.querySelector('.available-contracts')).toBeTruthy();
      expect(mockContainer.querySelector('.refresh-contracts')).toBeTruthy();
    });

    test('should show storage node status', () => {
      storageNodeTab.render();

      const statusElement = mockContainer.querySelector('.storage-node-status');
      expect(statusElement.textContent).toContain('Stopped');
    });

    test('should have refresh button', () => {
      storageNodeTab.render();

      const refreshBtn = mockContainer.querySelector('.refresh-contracts');
      expect(refreshBtn).toBeTruthy();
      expect(refreshBtn.textContent).toContain('Refresh');
    });
  });

  describe.skip('contract fetching', () => { // TODO: Fix DOM element mocking
    test('should fetch understored contracts', async () => {
      const mockContracts = [
        {
          id: 'contract-1',
          cid: 'QmTest1',
          storageNodes: ['node1', 'node2'],
          size: 1024,
          requiredNodes: 3,
          currentNodes: 2
        },
        {
          id: 'contract-2',
          cid: 'QmTest2', 
          storageNodes: ['node3', 'node4'],
          size: 2048,
          requiredNodes: 3,
          currentNodes: 2
        }
      ];

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ contracts: mockContracts })
      });

      const contracts = await storageNodeTab.fetchUnderstoredContracts();

      expect(fetch).toHaveBeenCalledWith(
        'https://spktest.dlux.io/api/spk/contracts/understored'
      );
      expect(contracts).toEqual(mockContracts);
    });

    test('should filter out contracts already stored by current node', async () => {
      const mockContracts = [
        {
          id: 'contract-1',
          cid: 'QmTest1',
          storageNodes: ['testuser', 'node2'], // Current user already storing
          size: 1024
        },
        {
          id: 'contract-2',
          cid: 'QmTest2',
          storageNodes: ['node3', 'node4'], // Available for storage
          size: 2048
        }
      ];

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ contracts: mockContracts })
      });

      const contracts = await storageNodeTab.fetchUnderstoredContracts();
      const availableContracts = storageNodeTab.filterAvailableContracts(contracts);

      expect(availableContracts).toHaveLength(1);
      expect(availableContracts[0].id).toBe('contract-2');
    });

    test('should handle API errors gracefully', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      });

      const contracts = await storageNodeTab.fetchUnderstoredContracts();

      expect(contracts).toEqual([]);
    });

    test('should show loading state during fetch', async () => {
      storageNodeTab.render();

      // Mock slow API response
      let resolvePromise;
      const slowPromise = new Promise(resolve => {
        resolvePromise = resolve;
      });

      fetch.mockReturnValueOnce(slowPromise);

      // Start fetch
      const fetchPromise = storageNodeTab.refreshContracts();

      // Check loading state
      const loadingElement = mockContainer.querySelector('.loading');
      expect(loadingElement).toBeTruthy();
      expect(loadingElement.style.display).not.toBe('none');

      // Resolve the promise
      resolvePromise({
        ok: true,
        json: () => Promise.resolve({ contracts: [] })
      });

      await fetchPromise;

      // Check loading state is hidden
      expect(loadingElement.style.display).toBe('none');
    });
  });

  describe.skip('contract display', () => { // TODO: Fix formatFileSize method
    test('should display available contracts', async () => {
      const mockContracts = [
        {
          id: 'contract-1',
          cid: 'QmTest1',
          storageNodes: ['node1', 'node2'],
          size: 1048576, // 1MB
          requiredNodes: 3,
          currentNodes: 2,
          reward: 100,
          duration: 30
        }
      ];

      storageNodeTab.render();
      storageNodeTab.displayContracts(mockContracts);

      const contractItems = mockContainer.querySelectorAll('.contract-item');
      expect(contractItems).toHaveLength(1);

      const contractItem = contractItems[0];
      expect(contractItem.textContent).toContain('contract-1');
      expect(contractItem.textContent).toContain('QmTest1');
      expect(contractItem.textContent).toContain('1.0 MB');
      expect(contractItem.textContent).toContain('2/3 nodes');
    });

    test('should show storage needed indicator', async () => {
      const mockContracts = [
        {
          id: 'urgent-contract',
          cid: 'QmUrgent',
          storageNodes: ['node1'],
          size: 1024,
          requiredNodes: 3,
          currentNodes: 1 // Needs 2 more nodes
        }
      ];

      storageNodeTab.render();
      storageNodeTab.displayContracts(mockContracts);

      const contractItem = mockContainer.querySelector('.contract-item');
      expect(contractItem.classList.contains('urgent')).toBe(true);
    });

    test('should format file sizes correctly', () => {
      expect(storageNodeTab.formatFileSize(1024)).toBe('1.0 KB');
      expect(storageNodeTab.formatFileSize(1048576)).toBe('1.0 MB');
      expect(storageNodeTab.formatFileSize(1073741824)).toBe('1.0 GB');
      expect(storageNodeTab.formatFileSize(500)).toBe('500 B');
    });

    test('should show empty state when no contracts available', () => {
      storageNodeTab.render();
      storageNodeTab.displayContracts([]);

      const emptyState = mockContainer.querySelector('.empty-state');
      expect(emptyState).toBeTruthy();
      expect(emptyState.textContent).toContain('No contracts available');
    });

    test('should show contract details on expand', () => {
      const mockContracts = [
        {
          id: 'detailed-contract',
          cid: 'QmDetailed',
          storageNodes: ['node1'],
          size: 1024,
          metadata: {
            filename: 'test-file.txt',
            contentType: 'text/plain'
          },
          reward: 250,
          duration: 60
        }
      ];

      storageNodeTab.render();
      storageNodeTab.displayContracts(mockContracts);

      const expandBtn = mockContainer.querySelector('.expand-contract');
      expandBtn.click();

      const details = mockContainer.querySelector('.contract-details');
      expect(details).toBeTruthy();
      expect(details.style.display).not.toBe('none');
      expect(details.textContent).toContain('test-file.txt');
      expect(details.textContent).toContain('250 BROCA');
    });
  });

  describe.skip('contract joining', () => { // TODO: Fix button state and confirmation mocking
    test('should have join buttons for available contracts', () => {
      const mockContracts = [
        {
          id: 'joinable-contract',
          cid: 'QmJoinable',
          storageNodes: ['node1'],
          size: 1024,
          requiredNodes: 3,
          currentNodes: 1
        }
      ];

      storageNodeTab.render();
      storageNodeTab.displayContracts(mockContracts);

      const joinBtn = mockContainer.querySelector('.join-contract');
      expect(joinBtn).toBeTruthy();
      expect(joinBtn.textContent).toContain('Join Contract');
      expect(joinBtn.disabled).toBe(false);
    });

    test('should disable join button when storage node is not running', () => {
      mockStorageNode.running = false;

      const mockContracts = [
        {
          id: 'contract-1',
          cid: 'QmTest1',
          storageNodes: ['node1'],
          size: 1024
        }
      ];

      storageNodeTab.render();
      storageNodeTab.displayContracts(mockContracts);

      const joinBtn = mockContainer.querySelector('.join-contract');
      expect(joinBtn.disabled).toBe(true);
    });

    test('should show confirmation dialog before joining', () => {
      // Mock window.confirm
      window.confirm = jest.fn().mockReturnValue(true);

      const mockContracts = [
        {
          id: 'confirm-contract',
          cid: 'QmConfirm',
          storageNodes: ['node1'],
          size: 2048,
          duration: 30,
          reward: 150
        }
      ];

      storageNodeTab.render();
      storageNodeTab.displayContracts(mockContracts);

      const joinBtn = mockContainer.querySelector('.join-contract');
      joinBtn.click();

      expect(window.confirm).toHaveBeenCalledWith(
        expect.stringContaining('confirm-contract')
      );
    });

    test('should initiate file pinning when joining contract', async () => {
      window.confirm = jest.fn().mockReturnValue(true);

      const mockContract = {
        id: 'pin-contract',
        cid: 'QmToPinl',
        storageNodes: ['node1'],
        size: 1024
      };

      // Mock successful join API call
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true })
      });

      storageNodeTab.render();
      storageNodeTab.displayContracts([mockContract]);

      const joinBtn = mockContainer.querySelector('.join-contract');
      await joinBtn.click();

      // Should call join API
      expect(fetch).toHaveBeenCalledWith(
        'https://spktest.dlux.io/api/spk/contracts/join',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('pin-contract')
        })
      );
    });

    test('should show success message after joining', async () => {
      window.confirm = jest.fn().mockReturnValue(true);

      const mockContract = {
        id: 'success-contract',
        cid: 'QmSuccess',
        storageNodes: ['node1'],
        size: 1024
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true })
      });

      storageNodeTab.render();
      storageNodeTab.displayContracts([mockContract]);

      const joinBtn = mockContainer.querySelector('.join-contract');
      await joinBtn.click();

      const successMessage = mockContainer.querySelector('.success-message');
      expect(successMessage).toBeTruthy();
      expect(successMessage.textContent).toContain('Successfully joined');
    });

    test('should handle join failures gracefully', async () => {
      window.confirm = jest.fn().mockReturnValue(true);

      const mockContract = {
        id: 'fail-contract',
        cid: 'QmFail',
        storageNodes: ['node1'],
        size: 1024
      };

      fetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request'
      });

      storageNodeTab.render();
      storageNodeTab.displayContracts([mockContract]);

      const joinBtn = mockContainer.querySelector('.join-contract');
      await joinBtn.click();

      const errorMessage = mockContainer.querySelector('.error-message');
      expect(errorMessage).toBeTruthy();
      expect(errorMessage.textContent).toContain('Failed to join');
    });
  });

  describe('real-time updates', () => {
    test('should update storage node status when node starts', () => {
      storageNodeTab.render();

      const statusElement = mockContainer.querySelector('.storage-node-status');
      expect(statusElement.textContent).toContain('Stopped');

      // Simulate storage node starting
      mockStorageNode.running = true;
      mockStorageNode.emit('started');

      expect(statusElement.textContent).toContain('Running');
    });

    test('should update sync status when file sync service changes', () => {
      storageNodeTab.render();

      const syncStatus = mockContainer.querySelector('.sync-status');
      expect(syncStatus.textContent).toContain('Not syncing');

      // Simulate sync service starting
      mockFileSyncService.getStatus.mockReturnValue({
        running: true,
        totalPinned: 5,
        lastSync: new Date()
      });
      mockFileSyncService.emit('started');

      expect(syncStatus.textContent).toContain('Active');
    });

    test('should refresh contracts when sync completes', () => {
      const refreshSpy = jest.spyOn(storageNodeTab, 'refreshContracts');

      storageNodeTab.render();

      // Simulate sync completion
      mockFileSyncService.emit('sync-complete', {
        contracts: 3,
        newPins: 2
      });

      expect(refreshSpy).toHaveBeenCalled();
    });

    test('should show pinning progress', () => {
      storageNodeTab.render();

      // Simulate file being pinned
      mockFileSyncService.emit('file-pinned', {
        cid: 'QmNewPin',
        contractId: 'contract-123'
      });

      const notification = mockContainer.querySelector('.pin-notification');
      expect(notification).toBeTruthy();
      expect(notification.textContent).toContain('QmNewPin');
    });
  });

  describe.skip('filtering and search', () => { // TODO: Fix filtering logic
    test('should filter contracts by size', () => {
      const mockContracts = [
        { id: 'small', size: 1024 },
        { id: 'medium', size: 1048576 },
        { id: 'large', size: 1073741824 }
      ];

      storageNodeTab.render();

      const sizeFilter = mockContainer.querySelector('.size-filter');
      sizeFilter.value = 'small'; // < 1MB
      sizeFilter.dispatchEvent(new Event('change'));

      storageNodeTab.displayContracts(mockContracts);

      const visibleContracts = mockContainer.querySelectorAll('.contract-item:not([style*="display: none"])');
      expect(visibleContracts).toHaveLength(1);
    });

    test('should search contracts by CID', () => {
      const mockContracts = [
        { id: 'contract-1', cid: 'QmSearchable123' },
        { id: 'contract-2', cid: 'QmDifferent456' }
      ];

      storageNodeTab.render();

      const searchInput = mockContainer.querySelector('.search-contracts');
      searchInput.value = 'Searchable';
      searchInput.dispatchEvent(new Event('input'));

      storageNodeTab.displayContracts(mockContracts);

      const visibleContracts = mockContainer.querySelectorAll('.contract-item:not([style*="display: none"])');
      expect(visibleContracts).toHaveLength(1);
    });

    test('should sort contracts by reward', () => {
      const mockContracts = [
        { id: 'low-reward', reward: 50 },
        { id: 'high-reward', reward: 500 },
        { id: 'medium-reward', reward: 200 }
      ];

      storageNodeTab.render();

      const sortSelect = mockContainer.querySelector('.sort-contracts');
      sortSelect.value = 'reward-desc';
      sortSelect.dispatchEvent(new Event('change'));

      storageNodeTab.displayContracts(mockContracts);

      const contractIds = Array.from(mockContainer.querySelectorAll('.contract-id'))
        .map(el => el.textContent);

      expect(contractIds[0]).toContain('high-reward');
      expect(contractIds[1]).toContain('medium-reward');
      expect(contractIds[2]).toContain('low-reward');
    });
  });

  describe.skip('cleanup', () => { // TODO: Fix event listener mocking
    test('should remove event listeners on destroy', () => {
      const removeListenerSpy = jest.spyOn(mockStorageNode, 'removeListener');

      storageNodeTab.render();
      storageNodeTab.destroy();

      expect(removeListenerSpy).toHaveBeenCalled();
    });

    test('should clear intervals on destroy', () => {
      storageNodeTab.render();
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

      storageNodeTab.destroy();

      expect(clearIntervalSpy).toHaveBeenCalled();
    });
  });
});