/**
 * Workflow Engine - Enterprise workflow management system
 * 
 * Features:
 * - Configurable workflow stages and transitions
 * - Approval chains and routing rules
 * - Conditional stage transitions
 * - SLA tracking and alerts
 * - Workflow history and audit trails
 * - Role-based stage permissions
 * - Automated actions on stage changes
 */

class WorkflowEngine {
  constructor() {
    this.workflows = this.loadWorkflows();
    this.workflowHistory = this.loadHistory();
  }

  // Load workflows from localStorage
  loadWorkflows() {
    try {
      const stored = localStorage.getItem("crm_workflows");
      return stored ? JSON.parse(stored) : this.getDefaultWorkflows();
    } catch {
      return this.getDefaultWorkflows();
    }
  }

  // Load workflow history
  loadHistory() {
    try {
      const stored = localStorage.getItem("crm_workflow_history");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  // Get default workflows
  getDefaultWorkflows() {
    return [
      {
        id: "lead_to_client",
        name: "Lead to Client Conversion",
        entityType: "lead",
        stages: [
          { id: "new", name: "New", order: 1, requiredFields: ["name", "email"], autoAdvance: false },
          { id: "contacted", name: "Contacted", order: 2, requiredFields: ["phone"], autoAdvance: false },
          { id: "qualified", name: "Qualified", order: 3, requiredFields: ["company", "value"], autoAdvance: false },
          { id: "proposal", name: "Proposal Sent", order: 4, requiredFields: ["proposalDate"], autoAdvance: false },
          { id: "won", name: "Won", order: 5, requiredFields: ["contractSigned"], autoAdvance: true, targetEntity: "client" },
          { id: "lost", name: "Lost", order: 6, requiredFields: ["lostReason"], autoAdvance: false },
        ],
        transitions: [
          { from: "new", to: "contacted", action: "contact_lead", requiredRole: ["Sales", "Admin"] },
          { from: "contacted", to: "qualified", action: "qualify_lead", requiredRole: ["Sales", "Admin"] },
          { from: "qualified", to: "proposal", action: "send_proposal", requiredRole: ["Sales", "Admin"] },
          { from: "proposal", to: "won", action: "convert_to_client", requiredRole: ["Sales", "Admin", "Manager"], requiresApproval: true },
          { from: "proposal", to: "lost", action: "mark_lost", requiredRole: ["Sales", "Admin"] },
        ],
        sla: {
          new: 24, // 24 hours to contact
          contacted: 72, // 72 hours to qualify
          qualified: 168, // 7 days to send proposal
          proposal: 336, // 14 days to close
        },
      },
      {
        id: "invoice_processing",
        name: "Invoice Processing",
        entityType: "invoice",
        stages: [
          { id: "draft", name: "Draft", order: 1, requiredFields: ["client", "amount"], autoAdvance: false },
          { id: "pending_approval", name: "Pending Approval", order: 2, requiredFields: [], autoAdvance: false },
          { id: "approved", name: "Approved", order: 3, requiredFields: [], autoAdvance: false },
          { id: "sent", name: "Sent", order: 4, requiredFields: ["sentDate"], autoAdvance: false },
          { id: "paid", name: "Paid", order: 5, requiredFields: ["paidDate"], autoAdvance: false },
          { id: "overdue", name: "Overdue", order: 6, requiredFields: [], autoAdvance: false },
        ],
        transitions: [
          { from: "draft", to: "pending_approval", action: "submit_for_approval", requiredRole: ["Accountant", "Admin"] },
          { from: "pending_approval", to: "approved", action: "approve_invoice", requiredRole: ["Manager", "Admin"], requiresApproval: true },
          { from: "pending_approval", to: "draft", action: "reject_invoice", requiredRole: ["Manager", "Admin"] },
          { from: "approved", to: "sent", action: "send_invoice", requiredRole: ["Accountant", "Admin"] },
          { from: "sent", to: "paid", action: "record_payment", requiredRole: ["Accountant", "Admin"] },
          { from: "sent", to: "overdue", action: "mark_overdue", auto: true },
        ],
        sla: {
          draft: 48, // 48 hours to submit
          pending_approval: 72, // 72 hours to approve
          sent: 30, // 30 days to pay
        },
      },
      {
        id: "task_lifecycle",
        name: "Task Lifecycle",
        entityType: "task",
        stages: [
          { id: "backlog", name: "Backlog", order: 1, requiredFields: ["title"], autoAdvance: false },
          { id: "todo", name: "To Do", order: 2, requiredFields: ["assignedTo"], autoAdvance: false },
          { id: "in_progress", name: "In Progress", order: 3, requiredFields: [], autoAdvance: false },
          { id: "review", name: "In Review", order: 4, requiredFields: [], autoAdvance: false },
          { id: "done", name: "Done", order: 5, requiredFields: ["completedDate"], autoAdvance: false },
        ],
        transitions: [
          { from: "backlog", to: "todo", action: "assign_task", requiredRole: ["Admin", "Manager"] },
          { from: "todo", to: "in_progress", action: "start_task", requiredRole: ["Admin", "Manager", "Operations"] },
          { from: "in_progress", to: "review", action: "submit_for_review", requiredRole: ["Admin", "Manager", "Operations"] },
          { from: "review", to: "done", action: "complete_task", requiredRole: ["Admin", "Manager"] },
          { from: "review", to: "in_progress", action: "request_changes", requiredRole: ["Admin", "Manager"] },
        ],
        sla: {
          todo: 168, // 7 days to start
          in_progress: 336, // 14 days to complete
          review: 72, // 3 days to review
        },
      },
    ];
  }

  // Save workflows to localStorage
  saveWorkflows() {
    try {
      localStorage.setItem("crm_workflows", JSON.stringify(this.workflows));
    } catch (error) {
      console.error("Failed to save workflows:", error);
    }
  }

  // Save workflow history
  saveHistory() {
    try {
      localStorage.setItem("crm_workflow_history", JSON.stringify(this.workflowHistory));
    } catch (error) {
      console.error("Failed to save workflow history:", error);
    }
  }

  // Get workflow by entity type
  getWorkflowByEntityType(entityType) {
    return this.workflows.find(w => w.entityType === entityType);
  }

  // Get workflow by ID
  getWorkflowById(workflowId) {
    return this.workflows.find(w => w.id === workflowId);
  }

  // Get all workflows
  getAllWorkflows() {
    return this.workflows;
  }

  // Add workflow
  addWorkflow(workflow) {
    const newWorkflow = {
      ...workflow,
      id: workflow.id || `workflow_${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    this.workflows.push(newWorkflow);
    this.saveWorkflows();
    return newWorkflow;
  }

  // Update workflow
  updateWorkflow(workflowId, updates) {
    const index = this.workflows.findIndex(w => w.id === workflowId);
    if (index !== -1) {
      this.workflows[index] = { ...this.workflows[index], ...updates, updatedAt: new Date().toISOString() };
      this.saveWorkflows();
      return this.workflows[index];
    }
    return null;
  }

  // Delete workflow
  deleteWorkflow(workflowId) {
    this.workflows = this.workflows.filter(w => w.id !== workflowId);
    this.saveWorkflows();
  }

  // Get stage by ID
  getStage(workflowId, stageId) {
    const workflow = this.getWorkflowById(workflowId);
    if (!workflow) return null;
    return workflow.stages.find(s => s.id === stageId);
  }

  // Get next stage
  getNextStage(workflowId, currentStageId) {
    const workflow = this.getWorkflowById(workflowId);
    if (!workflow) return null;
    
    const currentStage = workflow.stages.find(s => s.id === currentStageId);
    if (!currentStage) return null;
    
    return workflow.stages.find(s => s.order === currentStage.order + 1);
  }

  // Get transition
  getTransition(workflowId, fromStage, toStage) {
    const workflow = this.getWorkflowById(workflowId);
    if (!workflow) return null;
    return workflow.transitions.find(t => t.from === fromStage && t.to === toStage);
  }

  // Check if transition is allowed
  canTransition(workflowId, fromStage, toStage, userRole) {
    const transition = this.getTransition(workflowId, fromStage, toStage);
    if (!transition) return { allowed: false, reason: "Transition not defined" };
    
    if (transition.requiredRole && !transition.requiredRole.includes(userRole)) {
      return { allowed: false, reason: "Insufficient permissions" };
    }
    
    return { allowed: true, requiresApproval: transition.requiresApproval || false };
  }

  // Validate required fields for stage
  validateStageFields(workflowId, stageId, entityData) {
    const stage = this.getStage(workflowId, stageId);
    if (!stage || !stage.requiredFields) return { valid: true, missingFields: [] };
    
    const missingFields = stage.requiredFields.filter(field => !entityData[field]);
    
    return {
      valid: missingFields.length === 0,
      missingFields,
    };
  }

  // Execute transition
  async executeTransition(workflowId, entityId, fromStage, toStage, userId, userName, additionalData = {}) {
    const workflow = this.getWorkflowById(workflowId);
    if (!workflow) throw new Error("Workflow not found");
    
    const transition = this.getTransition(workflowId, fromStage, toStage);
    if (!transition) throw new Error("Transition not defined");
    
    // Log the transition
    const historyEntry = {
      id: `history_${Date.now()}`,
      workflowId,
      entityId,
      fromStage,
      toStage,
      action: transition.action,
      userId,
      userName,
      timestamp: new Date().toISOString(),
      additionalData,
    };
    
    this.workflowHistory.push(historyEntry);
    this.saveHistory();
    
    // Check for auto-advance
    const nextStage = this.getNextStage(workflowId, toStage);
    if (nextStage && nextStage.autoAdvance) {
      // Schedule auto-advance (would be handled by a job queue in production)
      console.log(`Auto-advance scheduled: ${toStage} -> ${nextStage.id}`);
    }
    
    return historyEntry;
  }

  // Get workflow history for entity
  getEntityHistory(entityId) {
    return this.workflowHistory.filter(h => h.entityId === entityId).sort((a, b) => 
      new Date(b.timestamp) - new Date(a.timestamp)
    );
  }

  // Check SLA compliance
  checkSLA(workflowId, stageId, entityCreatedAt) {
    const workflow = this.getWorkflowById(workflowId);
    if (!workflow || !workflow.sla) return { compliant: true, remaining: null };
    
    const slaHours = workflow.sla[stageId];
    if (!slaHours) return { compliant: true, remaining: null };
    
    const created = new Date(entityCreatedAt);
    const now = new Date();
    const elapsedHours = (now - created) / (1000 * 60 * 60);
    const remaining = slaHours - elapsedHours;
    
    return {
      compliant: remaining > 0,
      remaining: Math.max(0, remaining),
      slaHours,
      elapsedHours,
    };
  }

  // Get SLA alerts
  getSLAAlerts(workflowId, entities) {
    const workflow = this.getWorkflowById(workflowId);
    if (!workflow || !workflow.sla) return [];
    
    const alerts = [];
    const now = new Date();
    
    entities.forEach(entity => {
      if (!entity.stage || !entity.createdAt) return;
      
      const slaCheck = this.checkSLA(workflowId, entity.stage, entity.createdAt);
      
      if (!slaCheck.compliant) {
        alerts.push({
          entityId: entity.id,
          stage: entity.stage,
          overdueBy: slaCheck.elapsedHours - slaCheck.slaHours,
          severity: slaCheck.elapsedHours - slaCheck.slaHours > 24 ? "critical" : "warning",
        });
      } else if (slaCheck.remaining < 24) {
        alerts.push({
          entityId: entity.id,
          stage: entity.stage,
          remaining: slaCheck.remaining,
          severity: slaCheck.remaining < 12 ? "critical" : "warning",
        });
      }
    });
    
    return alerts;
  }

  // Get workflow statistics
  getWorkflowStats(workflowId, entities) {
    const workflow = this.getWorkflowById(workflowId);
    if (!workflow) return null;
    
    const stageCounts = {};
    workflow.stages.forEach(stage => {
      stageCounts[stage.id] = entities.filter(e => e.stage === stage.id).length;
    });
    
    const totalEntities = entities.length;
    const stagePercentages = {};
    Object.keys(stageCounts).forEach(stageId => {
      stagePercentages[stageId] = totalEntities > 0 ? (stageCounts[stageId] / totalEntities) * 100 : 0;
    });
    
    return {
      total: totalEntities,
      stageCounts,
      stagePercentages,
      averageTimeInStages: this.calculateAverageTimeInStages(workflowId, entities),
    };
  }

  // Calculate average time in stages
  calculateAverageTimeInStages(workflowId, entities) {
    const history = this.workflowHistory.filter(h => h.workflowId === workflowId);
    const stageTimes = {};
    
    entities.forEach(entity => {
      const entityHistory = history.filter(h => h.entityId === entity.id).sort((a, b) => 
        new Date(a.timestamp) - new Date(b.timestamp)
      );
      
      for (let i = 0; i < entityHistory.length - 1; i++) {
        const current = entityHistory[i];
        const next = entityHistory[i + 1];
        const duration = (new Date(next.timestamp) - new Date(current.timestamp)) / (1000 * 60 * 60); // hours
        
        if (!stageTimes[current.fromStage]) {
          stageTimes[current.fromStage] = [];
        }
        stageTimes[current.fromStage].push(duration);
      }
    });
    
    const averages = {};
    Object.keys(stageTimes).forEach(stageId => {
      const times = stageTimes[stageId];
      averages[stageId] = times.length > 0 
        ? times.reduce((sum, t) => sum + t, 0) / times.length 
        : 0;
    });
    
    return averages;
  }
}

// Singleton instance
const workflowEngine = new WorkflowEngine();

export default workflowEngine;
