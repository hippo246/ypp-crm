/**
 * Workflow Engine - Enterprise workflow management system
 *
 * Features:
 * - Configurable workflow stages and transitions
 * - Approval chains and routing rules
 * - Conditional stage transitions (rule-based routing)
 * - Parallel / concurrent stage support
 * - SLA tracking with pause/resume
 * - Workflow history, audit trails, and rollback
 * - Role-based stage permissions
 * - Automated actions on stage changes
 * - Event system (pub/sub) for stage changes, approvals, SLA breaches
 * - Transition middleware (pre/post hooks)
 * - Custom per-stage validators (beyond required-field presence)
 * - Bulk entity operations
 * - Workflow templates (clone/fork)
 * - Priority levels on entities
 */

// ─── Event Bus ───────────────────────────────────────────────────────────────

class EventBus {
  constructor() {
    this._listeners = {};
  }

  /** Subscribe to an event. Returns an unsubscribe function. */
  on(event, handler) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(h => h !== handler);
  }

  /** Subscribe once — auto-removes after first fire. */
  once(event, handler) {
    const wrapper = (...args) => { handler(...args); this.off(event, wrapper); };
    return this.on(event, wrapper);
  }

  emit(event, payload) {
    (this._listeners[event] || []).forEach(h => {
      try { h(payload); } catch (e) { console.error(`EventBus handler error [${event}]:`, e); }
    });
    // also emit wildcard
    (this._listeners["*"] || []).forEach(h => {
      try { h(event, payload); } catch (e) { console.error("EventBus wildcard handler error:", e); }
    });
  }
}

// ─── Middleware Pipeline ──────────────────────────────────────────────────────

class MiddlewarePipeline {
  constructor() {
    this._pre = [];
    this._post = [];
  }

  /** Register a pre-transition hook: async fn(context) → void | throw to abort */
  usePre(fn) { this._pre.push(fn); return this; }

  /** Register a post-transition hook: async fn(context, result) → void */
  usePost(fn) { this._post.push(fn); return this; }

  async runPre(context) {
    for (const fn of this._pre) await fn(context);
  }

  async runPost(context, result) {
    for (const fn of this._post) await fn(context, result);
  }
}

// ─── SLA Tracker ─────────────────────────────────────────────────────────────

class SLATracker {
  /**
   * Maintains pause intervals per entity+stage so SLA can be paused/resumed.
   * Stored as: { [`${entityId}:${stageId}`]: { pauses: [{start, end?}], ... } }
   */
  constructor(storage) {
    this._storage = storage;
    this._data = this._load();
  }

  _load() {
    try {
      const raw = this._storage.getItem("crm_sla_tracker");
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }

  _save() {
    try { this._storage.setItem("crm_sla_tracker", JSON.stringify(this._data)); }
    catch (e) { console.error("SLATracker save failed:", e); }
  }

  _key(entityId, stageId) { return `${entityId}:${stageId}`; }

  /** Start tracking SLA for an entity entering a stage. */
  start(entityId, stageId, enteredAt = new Date().toISOString()) {
    const key = this._key(entityId, stageId);
    this._data[key] = { enteredAt, pauses: [], active: true };
    this._save();
  }

  /** Stop tracking (entity left the stage). */
  stop(entityId, stageId) {
    const key = this._key(entityId, stageId);
    if (this._data[key]) {
      this._data[key].active = false;
      // close any open pause
      const last = this._data[key].pauses.at(-1);
      if (last && !last.end) last.end = new Date().toISOString();
      this._save();
    }
  }

  /** Pause the SLA clock (e.g. entity is waiting on a third party). */
  pause(entityId, stageId) {
    const key = this._key(entityId, stageId);
    const record = this._data[key];
    if (!record) return;
    const last = record.pauses.at(-1);
    if (last && !last.end) return; // already paused
    record.pauses.push({ start: new Date().toISOString(), end: null });
    this._save();
  }

  /** Resume the SLA clock. */
  resume(entityId, stageId) {
    const key = this._key(entityId, stageId);
    const record = this._data[key];
    if (!record) return;
    const last = record.pauses.at(-1);
    if (last && !last.end) {
      last.end = new Date().toISOString();
      this._save();
    }
  }

  /**
   * Returns elapsed hours (excluding paused intervals) since the entity
   * entered the stage.
   */
  getElapsedHours(entityId, stageId) {
    const key = this._key(entityId, stageId);
    const record = this._data[key];
    if (!record) return 0;

    const now = new Date();
    let totalMs = now - new Date(record.enteredAt);

    for (const { start, end } of record.pauses) {
      const pauseStart = new Date(start);
      const pauseEnd = end ? new Date(end) : now;
      totalMs -= Math.max(0, pauseEnd - pauseStart);
    }

    return Math.max(0, totalMs) / (1000 * 60 * 60);
  }

  /** Check SLA compliance for a given allowed hours budget. */
  check(entityId, stageId, slaHours) {
    const elapsed = this.getElapsedHours(entityId, stageId);
    const remaining = slaHours - elapsed;
    return {
      compliant: remaining > 0,
      remaining: Math.max(0, remaining),
      slaHours,
      elapsedHours: elapsed,
    };
  }

  /** True if this entity+stage is currently paused. */
  isPaused(entityId, stageId) {
    const record = this._data[this._key(entityId, stageId)];
    if (!record) return false;
    const last = record.pauses.at(-1);
    return !!(last && !last.end);
  }
}

// ─── WorkflowEngine ──────────────────────────────────────────────────────────

class WorkflowEngine {
  /**
   * @param {Storage} [storage]  - Pluggable storage (defaults to localStorage).
   *                               Pass a Map-backed shim for testing.
   */
  constructor(storage = localStorage) {
    this._storage = storage;
    this.events = new EventBus();
    this.middleware = new MiddlewarePipeline();
    this.slaTracker = new SLATracker(storage);

    /** Custom validators: Map<`${workflowId}:${stageId}`, fn(entityData) → {valid, errors[]}> */
    this._stageValidators = new Map();

    this.workflows = this._loadWorkflows();
    this.workflowHistory = this._loadHistory();
  }

  // ── Storage ───────────────────────────────────────────────────────────────

  _loadWorkflows() {
    try {
      const stored = this._storage.getItem("crm_workflows");
      return stored ? JSON.parse(stored) : this._getDefaultWorkflows();
    } catch { return this._getDefaultWorkflows(); }
  }

  _loadHistory() {
    try {
      const stored = this._storage.getItem("crm_workflow_history");
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  }

  _saveWorkflows() {
    try { this._storage.setItem("crm_workflows", JSON.stringify(this.workflows)); }
    catch (e) { console.error("Failed to save workflows:", e); }
  }

  _saveHistory() {
    try { this._storage.setItem("crm_workflow_history", JSON.stringify(this.workflowHistory)); }
    catch (e) { console.error("Failed to save workflow history:", e); }
  }

  // ── Default workflows ─────────────────────────────────────────────────────

  _getDefaultWorkflows() {
    return [
      {
        id: "lead_to_client",
        name: "Lead to Client Conversion",
        entityType: "lead",
        stages: [
          {
            id: "new", name: "New", order: 1,
            requiredFields: ["name", "email"],
            autoAdvance: false,
            parallel: false,
          },
          {
            id: "contacted", name: "Contacted", order: 2,
            requiredFields: ["phone"],
            autoAdvance: false,
            parallel: false,
          },
          {
            id: "qualified", name: "Qualified", order: 3,
            requiredFields: ["company", "value"],
            autoAdvance: false,
            parallel: false,
          },
          {
            id: "proposal", name: "Proposal Sent", order: 4,
            requiredFields: ["proposalDate"],
            autoAdvance: false,
            parallel: false,
          },
          {
            id: "won", name: "Won", order: 5,
            requiredFields: ["contractSigned"],
            autoAdvance: true,
            targetEntity: "client",
            parallel: false,
          },
          {
            id: "lost", name: "Lost", order: 6,
            requiredFields: ["lostReason"],
            autoAdvance: false,
            parallel: false,
          },
        ],
        transitions: [
          {
            from: "new", to: "contacted",
            action: "contact_lead",
            requiredRole: ["Sales", "Admin"],
          },
          {
            from: "contacted", to: "qualified",
            action: "qualify_lead",
            requiredRole: ["Sales", "Admin"],
          },
          {
            from: "qualified", to: "proposal",
            action: "send_proposal",
            requiredRole: ["Sales", "Admin"],
            // Conditional: skip proposal for high-value leads
            condition: (entityData) => entityData.value < 100000,
          },
          {
            // Express path: qualified → won (bypass proposal for pre-approved deals)
            from: "qualified", to: "won",
            action: "fast_track_convert",
            requiredRole: ["Admin", "Manager"],
            condition: (entityData) => entityData.preApproved === true,
            requiresApproval: true,
          },
          {
            from: "proposal", to: "won",
            action: "convert_to_client",
            requiredRole: ["Sales", "Admin", "Manager"],
            requiresApproval: true,
          },
          {
            from: "proposal", to: "lost",
            action: "mark_lost",
            requiredRole: ["Sales", "Admin"],
          },
        ],
        sla: {
          new: 24,
          contacted: 72,
          qualified: 168,
          proposal: 336,
        },
        priority: { default: "normal", levels: ["low", "normal", "high", "urgent"] },
      },
      {
        id: "invoice_processing",
        name: "Invoice Processing",
        entityType: "invoice",
        stages: [
          {
            id: "draft", name: "Draft", order: 1,
            requiredFields: ["client", "amount"],
            autoAdvance: false, parallel: false,
          },
          {
            id: "pending_approval", name: "Pending Approval", order: 2,
            requiredFields: [],
            autoAdvance: false, parallel: false,
          },
          {
            id: "approved", name: "Approved", order: 3,
            requiredFields: [],
            autoAdvance: false, parallel: false,
          },
          {
            id: "sent", name: "Sent", order: 4,
            requiredFields: ["sentDate"],
            autoAdvance: false, parallel: false,
          },
          {
            id: "paid", name: "Paid", order: 5,
            requiredFields: ["paidDate"],
            autoAdvance: false, parallel: false,
          },
          {
            id: "overdue", name: "Overdue", order: 6,
            requiredFields: [],
            autoAdvance: false, parallel: false,
          },
        ],
        transitions: [
          {
            from: "draft", to: "pending_approval",
            action: "submit_for_approval",
            requiredRole: ["Accountant", "Admin"],
          },
          {
            from: "pending_approval", to: "approved",
            action: "approve_invoice",
            requiredRole: ["Manager", "Admin"],
            requiresApproval: true,
          },
          {
            from: "pending_approval", to: "draft",
            action: "reject_invoice",
            requiredRole: ["Manager", "Admin"],
          },
          {
            from: "approved", to: "sent",
            action: "send_invoice",
            requiredRole: ["Accountant", "Admin"],
          },
          {
            from: "sent", to: "paid",
            action: "record_payment",
            requiredRole: ["Accountant", "Admin"],
          },
          {
            from: "sent", to: "overdue",
            action: "mark_overdue",
            auto: true,
          },
        ],
        sla: {
          draft: 48,
          pending_approval: 72,
          sent: 720, // 30 days in hours
        },
        priority: { default: "normal", levels: ["low", "normal", "high", "urgent"] },
      },
      {
        id: "task_lifecycle",
        name: "Task Lifecycle",
        entityType: "task",
        stages: [
          {
            id: "backlog", name: "Backlog", order: 1,
            requiredFields: ["title"],
            autoAdvance: false, parallel: false,
          },
          {
            id: "todo", name: "To Do", order: 2,
            requiredFields: ["assignedTo"],
            autoAdvance: false, parallel: false,
          },
          {
            id: "in_progress", name: "In Progress", order: 3,
            requiredFields: [],
            autoAdvance: false, parallel: false,
          },
          {
            id: "review", name: "In Review", order: 4,
            requiredFields: [],
            autoAdvance: false, parallel: false,
          },
          {
            id: "done", name: "Done", order: 5,
            requiredFields: ["completedDate"],
            autoAdvance: false, parallel: false,
          },
        ],
        transitions: [
          {
            from: "backlog", to: "todo",
            action: "assign_task",
            requiredRole: ["Admin", "Manager"],
          },
          {
            from: "todo", to: "in_progress",
            action: "start_task",
            requiredRole: ["Admin", "Manager", "Operations"],
          },
          {
            from: "in_progress", to: "review",
            action: "submit_for_review",
            requiredRole: ["Admin", "Manager", "Operations"],
          },
          {
            from: "review", to: "done",
            action: "complete_task",
            requiredRole: ["Admin", "Manager"],
          },
          {
            from: "review", to: "in_progress",
            action: "request_changes",
            requiredRole: ["Admin", "Manager"],
          },
        ],
        sla: {
          todo: 168,
          in_progress: 336,
          review: 72,
        },
        priority: { default: "normal", levels: ["low", "normal", "high", "urgent"] },
      },
    ];
  }

  // ── Workflow CRUD ─────────────────────────────────────────────────────────

  getWorkflowByEntityType(entityType) {
    return this.workflows.find(w => w.entityType === entityType) ?? null;
  }

  getWorkflowById(workflowId) {
    return this.workflows.find(w => w.id === workflowId) ?? null;
  }

  getAllWorkflows() { return this.workflows; }

  addWorkflow(workflow) {
    const newWorkflow = {
      ...workflow,
      id: workflow.id || `workflow_${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    this.workflows.push(newWorkflow);
    this._saveWorkflows();
    this.events.emit("workflow:created", { workflow: newWorkflow });
    return newWorkflow;
  }

  updateWorkflow(workflowId, updates) {
    const index = this.workflows.findIndex(w => w.id === workflowId);
    if (index === -1) return null;
    this.workflows[index] = {
      ...this.workflows[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this._saveWorkflows();
    this.events.emit("workflow:updated", { workflowId, updates });
    return this.workflows[index];
  }

  deleteWorkflow(workflowId) {
    this.workflows = this.workflows.filter(w => w.id !== workflowId);
    this._saveWorkflows();
    this.events.emit("workflow:deleted", { workflowId });
  }

  /**
   * Clone an existing workflow as a new template.
   * @param {string} workflowId - Source workflow
   * @param {string} newName    - Name for the clone
   * @param {string} [newId]    - Optional explicit ID
   */
  cloneWorkflow(workflowId, newName, newId) {
    const source = this.getWorkflowById(workflowId);
    if (!source) throw new Error(`Workflow "${workflowId}" not found`);

    // Deep-clone, strip runtime timestamps, assign new identity
    const clone = JSON.parse(JSON.stringify(source));
    clone.id = newId || `${source.id}_clone_${Date.now()}`;
    clone.name = newName;
    clone.clonedFrom = workflowId;
    delete clone.createdAt;
    delete clone.updatedAt;

    return this.addWorkflow(clone);
  }

  // ── Stage helpers ─────────────────────────────────────────────────────────

  getStage(workflowId, stageId) {
    return this.getWorkflowById(workflowId)?.stages.find(s => s.id === stageId) ?? null;
  }

  getNextStage(workflowId, currentStageId) {
    const workflow = this.getWorkflowById(workflowId);
    if (!workflow) return null;
    const current = workflow.stages.find(s => s.id === currentStageId);
    if (!current) return null;
    return workflow.stages.find(s => s.order === current.order + 1) ?? null;
  }

  /** Returns all stages reachable from a given stage (via defined transitions). */
  getReachableStages(workflowId, fromStageId) {
    const workflow = this.getWorkflowById(workflowId);
    if (!workflow) return [];
    const stageIds = workflow.transitions
      .filter(t => t.from === fromStageId)
      .map(t => t.to);
    return stageIds
      .map(id => workflow.stages.find(s => s.id === id))
      .filter(Boolean);
  }

  // ── Transition helpers ────────────────────────────────────────────────────

  getTransition(workflowId, fromStage, toStage) {
    return this.getWorkflowById(workflowId)?.transitions.find(
      t => t.from === fromStage && t.to === toStage
    ) ?? null;
  }

  /**
   * Check whether a transition is allowed for a given role and entity data.
   * Evaluates both role permissions and optional condition functions.
   *
   * @param {string} workflowId
   * @param {string} fromStage
   * @param {string} toStage
   * @param {string} userRole
   * @param {object} [entityData={}]  - Entity data for conditional transitions
   * @returns {{ allowed: boolean, reason?: string, requiresApproval?: boolean }}
   */
  canTransition(workflowId, fromStage, toStage, userRole, entityData = {}) {
    const transition = this.getTransition(workflowId, fromStage, toStage);
    if (!transition) return { allowed: false, reason: "Transition not defined" };

    if (transition.requiredRole && !transition.requiredRole.includes(userRole)) {
      return { allowed: false, reason: "Insufficient permissions" };
    }

    if (typeof transition.condition === "function") {
      let condResult;
      try { condResult = transition.condition(entityData); }
      catch (e) { return { allowed: false, reason: `Condition error: ${e.message}` }; }
      if (!condResult) return { allowed: false, reason: "Transition condition not met" };
    }

    return { allowed: true, requiresApproval: transition.requiresApproval || false };
  }

  /**
   * Returns all transitions currently available from a stage, filtered by
   * role and entity data conditions.
   *
   * @returns {Array<{ transition, stage }>}
   */
  getAvailableTransitions(workflowId, fromStage, userRole, entityData = {}) {
    const workflow = this.getWorkflowById(workflowId);
    if (!workflow) return [];

    return workflow.transitions
      .filter(t => t.from === fromStage)
      .filter(t => {
        const { allowed } = this.canTransition(workflowId, fromStage, t.to, userRole, entityData);
        return allowed;
      })
      .map(t => ({
        transition: t,
        stage: workflow.stages.find(s => s.id === t.to) ?? null,
      }));
  }

  // ── Validation ────────────────────────────────────────────────────────────

  /**
   * Register a custom validator for a stage.
   * The validator receives the entity data and returns { valid: bool, errors: string[] }.
   *
   * @param {string}   workflowId
   * @param {string}   stageId
   * @param {Function} validatorFn
   */
  registerStageValidator(workflowId, stageId, validatorFn) {
    this._stageValidators.set(`${workflowId}:${stageId}`, validatorFn);
  }

  /**
   * Validate an entity's data against a stage's required fields AND any
   * custom validator registered for that stage.
   *
   * @returns {{ valid: boolean, missingFields: string[], errors: string[] }}
   */
  validateStageFields(workflowId, stageId, entityData) {
    const stage = this.getStage(workflowId, stageId);
    const missingFields = stage?.requiredFields?.filter(f => !entityData[f]) ?? [];

    const customValidator = this._stageValidators.get(`${workflowId}:${stageId}`);
    let customErrors = [];
    if (customValidator) {
      try {
        const result = customValidator(entityData);
        if (!result.valid) customErrors = result.errors ?? [];
      } catch (e) {
        customErrors = [`Validator threw: ${e.message}`];
      }
    }

    return {
      valid: missingFields.length === 0 && customErrors.length === 0,
      missingFields,
      errors: customErrors,
    };
  }

  // ── Transition execution ──────────────────────────────────────────────────

  /**
   * Execute a workflow transition.
   *
   * Runs: pre-middleware → transition → SLA tracking → event emit → post-middleware
   *
   * @param {string}  workflowId
   * @param {string}  entityId
   * @param {string}  fromStage
   * @param {string}  toStage
   * @param {string}  userId
   * @param {string}  userName
   * @param {object}  [additionalData={}]
   * @returns {Promise<object>}  history entry
   */
  async executeTransition(
    workflowId, entityId, fromStage, toStage,
    userId, userName, additionalData = {}
  ) {
    const workflow = this.getWorkflowById(workflowId);
    if (!workflow) throw new Error(`Workflow "${workflowId}" not found`);

    const transition = this.getTransition(workflowId, fromStage, toStage);
    if (!transition) throw new Error(`No transition defined: ${fromStage} → ${toStage}`);

    const context = {
      workflowId, entityId, fromStage, toStage, userId, userName,
      transition, additionalData, timestamp: new Date().toISOString(),
    };

    // Pre-hooks (can throw to abort)
    await this.middleware.runPre(context);

    const historyEntry = {
      id: `history_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      workflowId,
      entityId,
      fromStage,
      toStage,
      action: transition.action,
      userId,
      userName,
      timestamp: context.timestamp,
      additionalData,
    };

    this.workflowHistory.push(historyEntry);
    this._saveHistory();

    // SLA: stop clock on old stage, start on new
    this.slaTracker.stop(entityId, fromStage);
    this.slaTracker.start(entityId, toStage);

    this.events.emit("transition:executed", { ...context, historyEntry });

    // Auto-advance check
    const nextStage = this.getNextStage(workflowId, toStage);
    if (nextStage?.autoAdvance) {
      this.events.emit("transition:autoAdvancePending", {
        workflowId, entityId, fromStage: toStage, toStage: nextStage.id,
      });
      console.log(`[WorkflowEngine] Auto-advance queued: ${toStage} → ${nextStage.id} (entity: ${entityId})`);
    }

    // Post-hooks
    await this.middleware.runPost(context, historyEntry);

    return historyEntry;
  }

  /**
   * Roll back the most recent transition for an entity.
   * Re-opens the previous stage and appends a rollback entry to history.
   *
   * @returns {Promise<object>}  rollback history entry
   */
  async rollbackTransition(entityId, userId, userName, reason = "") {
    const entityHistory = this.getEntityHistory(entityId);
    if (entityHistory.length < 1) throw new Error("No transitions to roll back");

    const last = entityHistory[0]; // sorted descending

    // Swap: restore entity to the fromStage
    const rollbackEntry = {
      id: `history_${Date.now()}_rollback`,
      workflowId: last.workflowId,
      entityId,
      fromStage: last.toStage,
      toStage: last.fromStage,
      action: "rollback",
      userId,
      userName,
      timestamp: new Date().toISOString(),
      additionalData: { rolledBackEntryId: last.id, reason },
      isRollback: true,
    };

    this.workflowHistory.push(rollbackEntry);
    this._saveHistory();

    // SLA: stop new stage, resume old stage tracking
    this.slaTracker.stop(entityId, last.toStage);
    this.slaTracker.start(entityId, last.fromStage);

    this.events.emit("transition:rolledBack", {
      entityId, rollbackEntry, originalEntry: last,
    });

    return rollbackEntry;
  }

  // ── Bulk operations ───────────────────────────────────────────────────────

  /**
   * Execute the same transition for multiple entities at once.
   * Returns a results array with per-entity success/failure.
   *
   * @param {string[]} entityIds
   * @param {string}   workflowId
   * @param {string}   fromStage
   * @param {string}   toStage
   * @param {string}   userId
   * @param {string}   userName
   * @param {object}   [additionalData={}]
   * @returns {Promise<Array<{ entityId, success, result?, error? }>>}
   */
  async bulkTransition(entityIds, workflowId, fromStage, toStage, userId, userName, additionalData = {}) {
    const results = await Promise.allSettled(
      entityIds.map(entityId =>
        this.executeTransition(workflowId, entityId, fromStage, toStage, userId, userName, additionalData)
      )
    );

    return results.map((r, i) => ({
      entityId: entityIds[i],
      success: r.status === "fulfilled",
      result: r.value ?? null,
      error: r.reason?.message ?? null,
    }));
  }

  /**
   * Validate a batch of entities against a target stage.
   * Useful for pre-flight checks before a bulk transition.
   *
   * @returns {Array<{ entityId, valid, missingFields, errors }>}
   */
  bulkValidate(workflowId, stageId, entities) {
    return entities.map(entity => ({
      entityId: entity.id,
      ...this.validateStageFields(workflowId, stageId, entity),
    }));
  }

  // ── History & audit ───────────────────────────────────────────────────────

  /** Returns history for a single entity, newest first. */
  getEntityHistory(entityId) {
    return this.workflowHistory
      .filter(h => h.entityId === entityId)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  /**
   * Returns history filtered by action type, user, or date range.
   *
   * @param {object} filters
   * @param {string}   [filters.workflowId]
   * @param {string}   [filters.action]
   * @param {string}   [filters.userId]
   * @param {string}   [filters.fromDate]  - ISO string
   * @param {string}   [filters.toDate]    - ISO string
   */
  queryHistory({ workflowId, action, userId, fromDate, toDate } = {}) {
    return this.workflowHistory.filter(h => {
      if (workflowId && h.workflowId !== workflowId) return false;
      if (action && h.action !== action) return false;
      if (userId && h.userId !== userId) return false;
      if (fromDate && new Date(h.timestamp) < new Date(fromDate)) return false;
      if (toDate && new Date(h.timestamp) > new Date(toDate)) return false;
      return true;
    }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  // ── SLA ───────────────────────────────────────────────────────────────────

  /**
   * Check SLA for an entity in a specific stage using the SLATracker
   * (respects pause/resume).
   */
  checkSLA(workflowId, stageId, entityId) {
    const workflow = this.getWorkflowById(workflowId);
    if (!workflow?.sla) return { compliant: true, remaining: null };

    const slaHours = workflow.sla[stageId];
    if (!slaHours) return { compliant: true, remaining: null };

    return this.slaTracker.check(entityId, stageId, slaHours);
  }

  /** Pause SLA tracking for an entity (e.g. waiting on external response). */
  pauseSLA(entityId, stageId) {
    this.slaTracker.pause(entityId, stageId);
    this.events.emit("sla:paused", { entityId, stageId });
  }

  /** Resume SLA tracking. */
  resumeSLA(entityId, stageId) {
    this.slaTracker.resume(entityId, stageId);
    this.events.emit("sla:resumed", { entityId, stageId });
  }

  /**
   * Get SLA alerts for a collection of entities.
   * Emits `sla:breach` events for overdue items.
   *
   * @param {string}  workflowId
   * @param {Array}   entities    - each must have { id, stage }
   * @returns {Array<{ entityId, stage, overdueBy?, remaining?, severity }>}
   */
  getSLAAlerts(workflowId, entities) {
    const workflow = this.getWorkflowById(workflowId);
    if (!workflow?.sla) return [];

    const alerts = [];

    entities.forEach(entity => {
      if (!entity.stage) return;

      const slaCheck = this.checkSLA(workflowId, entity.stage, entity.id);
      if (!slaCheck.slaHours) return; // stage has no SLA

      const paused = this.slaTracker.isPaused(entity.id, entity.stage);

      if (!slaCheck.compliant) {
        const overdueBy = slaCheck.elapsedHours - slaCheck.slaHours;
        const alert = {
          entityId: entity.id,
          stage: entity.stage,
          overdueBy,
          severity: overdueBy > 24 ? "critical" : "warning",
          paused,
        };
        alerts.push(alert);
        this.events.emit("sla:breach", { workflowId, ...alert });
      } else if (slaCheck.remaining < 24) {
        alerts.push({
          entityId: entity.id,
          stage: entity.stage,
          remaining: slaCheck.remaining,
          severity: slaCheck.remaining < 12 ? "critical" : "warning",
          paused,
        });
      }
    });

    return alerts;
  }

  // ── Statistics ────────────────────────────────────────────────────────────

  /**
   * Compute per-stage counts, percentages, and average time-in-stage.
   * Also returns a simple conversion funnel drop-off analysis.
   *
   * @param {string} workflowId
   * @param {Array}  entities    - each must have { id, stage }
   */
  getWorkflowStats(workflowId, entities) {
    const workflow = this.getWorkflowById(workflowId);
    if (!workflow) return null;

    const stageCounts = Object.fromEntries(
      workflow.stages.map(s => [s.id, entities.filter(e => e.stage === s.id).length])
    );

    const total = entities.length;
    const stagePercentages = Object.fromEntries(
      Object.entries(stageCounts).map(([id, count]) => [id, total > 0 ? (count / total) * 100 : 0])
    );

    const averageTimeInStages = this._calculateAverageTimeInStages(workflowId, entities);

    // Funnel analysis: drop-off between consecutive stages (by order)
    const orderedStages = [...workflow.stages].sort((a, b) => a.order - b.order);
    const funnelDropOff = [];
    for (let i = 0; i < orderedStages.length - 1; i++) {
      const current = orderedStages[i];
      const next = orderedStages[i + 1];
      const currentCount = stageCounts[current.id] ?? 0;
      const nextCount = stageCounts[next.id] ?? 0;
      const enteredCurrent = this.workflowHistory.filter(
        h => h.workflowId === workflowId && h.toStage === current.id
      ).length;
      const enteredNext = this.workflowHistory.filter(
        h => h.workflowId === workflowId && h.toStage === next.id
      ).length;
      const conversionRate = enteredCurrent > 0
        ? ((enteredNext / enteredCurrent) * 100).toFixed(1)
        : null;
      funnelDropOff.push({
        from: current.id,
        to: next.id,
        conversionRate: conversionRate !== null ? parseFloat(conversionRate) : null,
      });
    }

    return {
      total,
      stageCounts,
      stagePercentages,
      averageTimeInStages,
      funnelDropOff,
    };
  }

  _calculateAverageTimeInStages(workflowId, entities) {
    const history = this.workflowHistory.filter(h => h.workflowId === workflowId);
    const stageTimes = {};

    entities.forEach(entity => {
      const entityHistory = history
        .filter(h => h.entityId === entity.id)
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      for (let i = 0; i < entityHistory.length - 1; i++) {
        const current = entityHistory[i];
        const next = entityHistory[i + 1];
        const durationHours = (new Date(next.timestamp) - new Date(current.timestamp)) / (1000 * 60 * 60);

        if (!stageTimes[current.fromStage]) stageTimes[current.fromStage] = [];
        stageTimes[current.fromStage].push(durationHours);
      }
    });

    return Object.fromEntries(
      Object.entries(stageTimes).map(([stageId, times]) => [
        stageId,
        times.length > 0 ? times.reduce((s, t) => s + t, 0) / times.length : 0,
      ])
    );
  }

  // ── Priority helpers ──────────────────────────────────────────────────────

  /**
   * Get the allowed priority levels for a workflow.
   * @returns {string[]}
   */
  getPriorityLevels(workflowId) {
    return this.getWorkflowById(workflowId)?.priority?.levels ?? ["low", "normal", "high", "urgent"];
  }

  /**
   * Sort entities by priority (urgent first) using the workflow's level order.
   * Entities with no priority are treated as the workflow's default.
   */
  sortByPriority(workflowId, entities) {
    const levels = this.getPriorityLevels(workflowId);
    const defaultPriority = this.getWorkflowById(workflowId)?.priority?.default ?? "normal";
    return [...entities].sort((a, b) => {
      const ai = levels.indexOf(a.priority ?? defaultPriority);
      const bi = levels.indexOf(b.priority ?? defaultPriority);
      return bi - ai; // higher index = higher priority (urgent last in array, but highest)
    });
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────

const workflowEngine = new WorkflowEngine();

export default workflowEngine;
export { WorkflowEngine, EventBus, MiddlewarePipeline, SLATracker };
