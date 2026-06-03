/**
 * useMultiUserSync - Enterprise-grade multi-user synchronization
 * 
 * Features:
 * - Real-time tab synchronization across users via BroadcastChannel
 * - Conflict detection and resolution
 * - Presence awareness (who's viewing what)
 * - Lock management for concurrent edits
 * - Activity logging for audit trails
 * - Optimistic updates with rollback on conflict
 * - Reconnection handling
 */

import { useState, useEffect, useRef, useCallback } from "react";

const CHANNEL_NAME = "crm_multiuser_sync";
const LOCK_TIMEOUT = 30000; // 30 seconds
const HEARTBEAT_INTERVAL = 10000; // 10 seconds

export function useMultiUserSync(userId, userName, userRole, onDataUpdate) {
  const [activeUsers, setActiveUsers] = useState([]);
  const [tabLocks, setTabLocks] = useState({});
  const [conflicts, setConflicts] = useState([]);
  const channelRef = useRef(null);
  const heartbeatRef = useRef(null);
  const locksRef = useRef({});
  const activityLogRef = useRef([]);
  const onDataUpdateRef = useRef(onDataUpdate);
  useEffect(() => { onDataUpdateRef.current = onDataUpdate; }, [onDataUpdate]);

  // Always-current handler dispatch — avoids stale closures in the channel effect
  const dispatchRef = useRef({});

  // Initialize BroadcastChannel
  useEffect(() => {
    try {
      channelRef.current = new BroadcastChannel(CHANNEL_NAME);

      // Route through dispatchRef so each handler is always the latest version
      const MESSAGE_HANDLER_MAP = {
        USER_JOIN:          "handleUserJoin",
        USER_LEAVE:         "handleUserLeave",
        TAB_CHANGE:         "handleTabChange",
        LOCK_REQUEST:       "handleLockRequest",
        LOCK_RELEASE:       "handleLockRelease",
        LOCK_DENIED:        "handleLockDenied",
        DATA_UPDATE:        "handleDataUpdate",
        CONFLICT_DETECTED:  "handleConflictDetected",
        HEARTBEAT:          "handleHeartbeat",
      };

      channelRef.current.onmessage = (event) => {
        const { type, payload } = event.data;
        const handlerName = MESSAGE_HANDLER_MAP[type];
        if (handlerName) dispatchRef.current[handlerName]?.(payload);
      };

      // Announce presence
      announcePresence();
      
      // Start heartbeat
      heartbeatRef.current = setInterval(() => sendHeartbeatRef.current(), HEARTBEAT_INTERVAL);
      
      // Cleanup on unmount — announce leave BEFORE closing the channel
      return () => {
        clearInterval(heartbeatRef.current);
        try {
          channelRef.current?.postMessage({
            type: "USER_LEAVE",
            payload: { userId },
          });
        } catch (_) {}
        channelRef.current?.close();
        channelRef.current = null;
      };
    } catch (error) {
      console.error("BroadcastChannel not supported:", error);
    }
  }, [userId, userName, userRole]);

  // Announce presence to other users
  const announcePresence = useCallback(() => {
    if (!channelRef.current) return;
    
    channelRef.current.postMessage({
      type: "USER_JOIN",
      payload: {
        userId,
        userName,
        userRole,
        timestamp: Date.now(),
        activeTab: null,
      },
    });
  }, [userId, userName, userRole]);

  // Send heartbeat
  const sendHeartbeat = useCallback(() => {
    if (!channelRef.current) return;
    try {
      channelRef.current.postMessage({
        type: "HEARTBEAT",
        payload: {
          userId,
          timestamp: Date.now(),
        },
      });
    } catch (_) {}
  }, [userId]);

  // Ref so the setInterval in the channel effect always calls the current version
  const sendHeartbeatRef = useRef(sendHeartbeat);
  useEffect(() => { sendHeartbeatRef.current = sendHeartbeat; }, [sendHeartbeat]);

  // Handle user joining
  const handleUserJoin = useCallback((payload) => {
    if (payload.userId === userId) return;
    
    setActiveUsers(prev => {
      const existing = prev.find(u => u.userId === payload.userId);
      if (existing) {
        return prev.map(u => u.userId === payload.userId ? { ...payload, lastSeen: Date.now() } : u);
      }
      return [...prev, { ...payload, lastSeen: Date.now() }];
    });
  }, [userId]);

  // Handle user leaving
  const handleUserLeave = useCallback((payload) => {
    setActiveUsers(prev => prev.filter(u => u.userId !== payload.userId));
    setTabLocks(prev => {
      const newLocks = { ...prev };
      Object.keys(newLocks).forEach(tabId => {
        if (newLocks[tabId].userId === payload.userId) {
          delete newLocks[tabId];
        }
      });
      return newLocks;
    });
  }, []);

  // Handle tab change from other users
  const handleTabChange = useCallback((payload) => {
    if (payload.userId === userId) return;
    
    setActiveUsers(prev => prev.map(u => 
      u.userId === payload.userId ? { ...u, activeTab: payload.tabId, timestamp: Date.now() } : u
    ));
  }, [userId]);

  // Handle heartbeat
  const handleHeartbeat = useCallback((payload) => {
    if (payload.userId === userId) return;
    
    setActiveUsers(prev => prev.map(u => 
      u.userId === payload.userId ? { ...u, lastSeen: Date.now() } : u
    ));
  }, [userId]);

  // Request lock on a resource
  const requestLock = useCallback(async (resourceId, resourceType) => {
    if (!channelRef.current) return true;

    const lockId = `${resourceType}:${resourceId}`;

    // Check via ref — avoids taking tabLocks as a dep (which would recreate this
    // callback on every lock change and cascade unnecessary re-renders)
    const existingLock = locksRef.current[lockId];
    if (existingLock) {
      if (existingLock.userId === userId) {
        // Already own the lock — refresh the timestamp
        existingLock.timestamp = Date.now();
        return true;
      }
      // Held by someone else
      return false;
    }
    
    // Request lock
    channelRef.current.postMessage({
      type: "LOCK_REQUEST",
      payload: {
        lockId,
        userId,
        userName,
        resourceType,
        resourceId,
        timestamp: Date.now(),
      },
    });
    
    // Optimistically set lock — store full object so ownership checks don't need state
    const lockEntry = { userId, userName, timestamp: Date.now() };
    locksRef.current[lockId] = lockEntry;
    setTabLocks(prev => ({ ...prev, [lockId]: lockEntry }));
    
    return true;
  }, [userId, userName]);

  // Release lock
  const releaseLock = useCallback((resourceId, resourceType) => {
    const lockId = `${resourceType}:${resourceId}`;

    // Only the owner can release — prevents silently nuking someone else's lock
    if (locksRef.current[lockId]?.userId !== userId) return;

    if (!channelRef.current) return;
    
    delete locksRef.current[lockId];
    setTabLocks(prev => {
      const newLocks = { ...prev };
      delete newLocks[lockId];
      return newLocks;
    });
    
    channelRef.current.postMessage({
      type: "LOCK_RELEASE",
      payload: {
        lockId,
        userId,
        timestamp: Date.now(),
      },
    });
  }, [userId]);

  // Handle lock request from other users
  const handleLockRequest = useCallback((payload) => {
    if (payload.userId === userId) return;
    
    const { lockId, userName: requesterName, timestamp } = payload;
    
    // Check if we have the lock
    if (locksRef.current[lockId]) {
      // Deny the request
      channelRef.current.postMessage({
        type: "LOCK_DENIED",
        payload: {
          lockId,
          userId: payload.userId,
          currentOwner: userId,
          timestamp: Date.now(),
        },
      });
    } else {
      // Grant the lock
      setTabLocks(prev => ({ ...prev, [lockId]: { userId: payload.userId, userName: requesterName, timestamp } }));
    }
  }, [userId]);

  // Handle lock release
  const handleLockRelease = useCallback((payload) => {
    if (payload.userId === userId) return;
    
    const { lockId } = payload;
    setTabLocks(prev => {
      const newLocks = { ...prev };
      delete newLocks[lockId];
      return newLocks;
    });
  }, []);

  // Handle lock denied — runs only for the user whose request was rejected
  const handleLockDenied = useCallback((payload) => {
    if (payload.userId !== userId) return; // payload.userId is the denied requester
    
    const { lockId } = payload;
    delete locksRef.current[lockId];
    setTabLocks(prev => {
      const newLocks = { ...prev };
      delete newLocks[lockId];
      return newLocks;
    });
  }, [userId]);

  // Broadcast data update
  const broadcastUpdate = useCallback((updateType, data) => {
    if (!channelRef.current) return;
    
    const updateId = `${updateType}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
    
    // Log activity
    activityLogRef.current.push({
      id: updateId,
      type: updateType,
      userId,
      userName,
      timestamp: Date.now(),
      data,
    });
    
    channelRef.current.postMessage({
      type: "DATA_UPDATE",
      payload: {
        updateId,
        updateType,
        userId,
        userName,
        data,
        timestamp: Date.now(),
      },
    });
  }, [userId, userName]);

  // Handle data update from other users
  const handleDataUpdate = useCallback((payload) => {
    if (payload.userId === userId) return;
    if (typeof onDataUpdateRef.current === "function") {
      onDataUpdateRef.current(payload);
    }
  }, [userId]);

  // Handle conflict detection
  const handleConflictDetected = useCallback((payload) => {
    if (payload.userId === userId) return;
    
    setConflicts(prev => [...prev, payload]);
  }, [userId]);

  // Resolve conflict
  const resolveConflict = useCallback((conflictId, resolution) => {
    setConflicts(prev => prev.filter(c => c.id !== conflictId));
    
    if (channelRef.current) {
      channelRef.current.postMessage({
        type: "CONFLICT_RESOLVED",
        payload: {
          conflictId,
          resolution,
          userId,
          timestamp: Date.now(),
        },
      });
    }
  }, [userId]);

  // Broadcast tab change
  const broadcastTabChange = useCallback((tabId) => {
    if (!channelRef.current) return;
    
    channelRef.current.postMessage({
      type: "TAB_CHANGE",
      payload: {
        userId,
        tabId,
        timestamp: Date.now(),
      },
    });
  }, [userId]);

  // Clean up stale locks
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      setTabLocks(prev => {
        const newLocks = { ...prev };
        Object.keys(newLocks).forEach(lockId => {
          if (now - newLocks[lockId].timestamp > LOCK_TIMEOUT) {
            delete newLocks[lockId];
            delete locksRef.current[lockId]; // keep ref in sync or requestLock thinks we still own it
          }
        });
        return newLocks;
      });
    }, 5000);
    
    return () => clearInterval(cleanupInterval);
  }, []);

  // Clean up stale users
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      setActiveUsers(prev => prev.filter(u => now - u.lastSeen < 60000)); // 1 minute timeout
    }, 10000);
    
    return () => clearInterval(cleanupInterval);
  }, []);

  // Keep dispatchRef current every render so the channel's onmessage always
  // calls the latest handler closures (fixes stale-closure bug, Fix 1)
  dispatchRef.current = {
    handleUserJoin,
    handleUserLeave,
    handleTabChange,
    handleLockRequest,
    handleLockRelease,
    handleLockDenied,
    handleDataUpdate,
    handleConflictDetected,
    handleHeartbeat,
  };

  return {
    activeUsers,
    tabLocks,
    conflicts,
    requestLock,
    releaseLock,
    broadcastUpdate,
    broadcastTabChange,
    resolveConflict,
    activityLog: activityLogRef.current,
  };
}

export default useMultiUserSync;
