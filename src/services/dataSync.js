/**
 * DataSync - Enterprise data persistence and synchronization strategy
 * 
 * Features:
 * - Optimistic updates with rollback
 * - Conflict resolution
 * - Offline queue management
 * - Batch operations for performance
 * - IndexedDB for large datasets
 * - Sync status tracking
 */

class DataSync {
  constructor() {
    this.dbName = "crm_enterprise_db";
    this.dbVersion = 1;
    this.db = null;
    this.syncQueue = [];
    this.syncInProgress = false;
    this.listeners = new Map();
  }

  // Initialize IndexedDB
  async initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Create object stores
        if (!db.objectStoreNames.contains("leads")) {
          db.createObjectStore("leads", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("clients")) {
          db.createObjectStore("clients", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("tasks")) {
          db.createObjectStore("tasks", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("accounting")) {
          db.createObjectStore("accounting", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("inventory")) {
          db.createObjectStore("inventory", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("sync_queue")) {
          const queueStore = db.createObjectStore("sync_queue", { keyPath: "id" });
          queueStore.createIndex("timestamp", "timestamp");
        }
        if (!db.objectStoreNames.contains("sync_status")) {
          db.createObjectStore("sync_status", { keyPath: "key" });
        }
      };
    });
  }

  // Get data from IndexedDB
  async getData(storeName) {
    if (!this.db) await this.initDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], "readonly");
      const store = transaction.objectStore(storeName);
      const request = store.getAll();
      
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Save data to IndexedDB
  async saveData(storeName, data) {
    if (!this.db) await this.initDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], "readwrite");
      const store = transaction.objectStore(storeName);
      
      if (Array.isArray(data)) {
        data.forEach(item => store.put(item));
      } else {
        store.put(data);
      }
      
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  // Delete data from IndexedDB
  async deleteData(storeName, id) {
    if (!this.db) await this.initDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], "readwrite");
      const store = transaction.objectStore(storeName);
      const request = store.delete(id);
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // Add operation to sync queue
  async queueOperation(operation) {
    const queuedOp = {
      id: `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      operation,
      status: "pending",
      retries: 0,
    };
    
    this.syncQueue.push(queuedOp);
    await this.saveData("sync_queue", queuedOp);
    
    // Trigger sync if not already in progress
    if (!this.syncInProgress) {
      this.processSyncQueue();
    }
    
    return queuedOp.id;
  }

  // Process sync queue
  async processSyncQueue() {
    if (this.syncInProgress) return;
    this.syncInProgress = true;
    
    try {
      const queue = await this.getData("sync_queue");
      const pendingOps = queue.filter(op => op.status === "pending");
      
      for (const op of pendingOps) {
        try {
          await this.executeOperation(op.operation);
          
          // Update status to completed
          op.status = "completed";
          await this.saveData("sync_queue", op);
          
          // Notify listeners
          this.emit("sync:completed", op);
        } catch (error) {
          op.retries = (op.retries || 0) + 1;
          
          if (op.retries >= 3) {
            op.status = "failed";
            await this.saveData("sync_queue", op);
            this.emit("sync:failed", op);
          } else {
            await this.saveData("sync_queue", op);
          }
        }
      }
      
      // Clean up completed operations older than 7 days
      await this.cleanupSyncQueue();
    } finally {
      this.syncInProgress = false;
    }
  }

  // Execute operation
  async executeOperation(operation) {
    const { type, storeName, data } = operation;
    
    switch (type) {
      case "create":
        await this.saveData(storeName, data);
        break;
      case "update":
        await this.saveData(storeName, data);
        break;
      case "delete":
        await this.deleteData(storeName, data.id);
        break;
      default:
        throw new Error(`Unknown operation type: ${type}`);
    }
  }

  // Clean up old sync queue items
  async cleanupSyncQueue() {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const queue = await this.getData("sync_queue");
    
    for (const op of queue) {
      if (op.status === "completed" && op.timestamp < sevenDaysAgo) {
        await this.deleteData("sync_queue", op.id);
      }
    }
  }

  // Get sync status
  async getSyncStatus() {
    const queue = await this.getData("sync_queue");
    
    return {
      pending: queue.filter(op => op.status === "pending").length,
      failed: queue.filter(op => op.status === "failed").length,
      completed: queue.filter(op => op.status === "completed").length,
      lastSync: queue.length > 0 
        ? new Date(Math.max(...queue.map(op => op.timestamp))).toISOString()
        : null,
    };
  }

  // Optimistic update with rollback
  async optimisticUpdate(storeName, id, updates, rollbackValue) {
    // Get current value for rollback
    const currentData = await this.getData(storeName);
    const currentValue = currentData.find(item => item.id === id);
    
    // Apply update optimistically
    const updatedValue = { ...currentValue, ...updates };
    await this.saveData(storeName, updatedValue);
    
    // Queue the operation
    const opId = await this.queueOperation({
      type: "update",
      storeName,
      data: updatedValue,
    });
    
    // Return rollback function
    return async () => {
      await this.saveData(storeName, currentValue || rollbackValue);
      // Remove from queue
      await this.deleteData("sync_queue", opId);
    };
  }

  // Batch operations for performance
  async batchOperations(operations) {
    const opIds = [];
    
    for (const op of operations) {
      const opId = await this.queueOperation(op);
      opIds.push(opId);
    }
    
    return opIds;
  }

  // Event listener management
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      const callbacks = this.listeners.get(event);
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(callback => callback(data));
    }
  }

  // Export data for backup
  async exportData(storeNames) {
    const exportData = {};
    
    for (const storeName of storeNames) {
      exportData[storeName] = await this.getData(storeName);
    }
    
    return JSON.stringify(exportData, null, 2);
  }

  // Import data from backup
  async importData(jsonData) {
    const data = JSON.parse(jsonData);
    
    for (const [storeName, items] of Object.entries(data)) {
      if (Array.isArray(items)) {
        for (const item of items) {
          await this.saveData(storeName, item);
        }
      }
    }
  }

  // Clear all data
  async clearAll() {
    const storeNames = ["leads", "clients", "tasks", "accounting", "inventory", "sync_queue", "sync_status"];
    
    for (const storeName of storeNames) {
      const transaction = this.db.transaction([storeName], "readwrite");
      const store = transaction.objectStore(storeName);
      store.clear();
    }
  }

  // Get storage usage
  async getStorageUsage() {
    if (!this.db) await this.initDB();
    
    const storeNames = ["leads", "clients", "tasks", "accounting", "inventory"];
    const usage = {};
    
    for (const storeName of storeNames) {
      const data = await this.getData(storeName);
      const size = new Blob([JSON.stringify(data)]).size;
      usage[storeName] = {
        count: data.length,
        sizeBytes: size,
        sizeMB: (size / (1024 * 1024)).toFixed(2),
      };
    }
    
    return usage;
  }
}

// Singleton instance
const dataSync = new DataSync();

export default dataSync;
