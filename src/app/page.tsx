'use client';

import React, { useState, useEffect } from 'react';
import { useAuthenticationStatus, useSignOut, useUserId } from '@nhost/react';
import { useQuery, useMutation, useSubscription } from '@apollo/client';
import { useRouter } from 'next/navigation';
import { 
  Play, Pause, Plus, Trash2, Shield, Settings, UserPlus, LogOut, 
  Workflow, Database, Cpu, Globe, Bell, CheckCircle2, AlertTriangle, 
  RefreshCw, User, Users, ChevronRight, LayoutDashboard, Copy, ArrowUp, ArrowDown
} from 'lucide-react';
import { gql } from '@apollo/client';

// ==========================================
// GraphQL Queries, Mutations, Subscriptions
// ==========================================

const GET_USER_ORGS = gql`
  query GetUserOrgs {
    org_members {
      role
      org {
        id
        name
      }
    }
  }
`;

const CREATE_ORG = gql`
  mutation CreateOrg($name: String!, $user_id: uuid!) {
    insert_organizations_one(object: {
      name: $name,
      org_members: {
        data: {
          user_id: $user_id,
          role: "owner"
        }
      }
    }) {
      id
      name
    }
  }
`;

const GET_ORG_STATS = gql`
  query GetOrgStats($org_id: uuid!) {
    org_usage_stats_by_pk(org_id: $org_id) {
      org_id
      org_name
      quota_limit
      quota_used
      total_runs
      completed_runs
      failed_runs
      paused_runs
      avg_duration_seconds
    }
  }
`;

const GET_WORKFLOWS = gql`
  query GetWorkflows($org_id: uuid!) {
    workflows(where: { org_id: { _eq: $org_id } }) {
      id
      name
      is_active
      steps(order_by: { position: asc }) {
        id
        name
        type
        config
        position
      }
      triggers {
        id
        type
        config
      }
      runs(order_by: { created_at: desc }, limit: 1) {
        id
        status
        created_at
      }
    }
  }
`;

const CREATE_WORKFLOW = gql`
  mutation CreateWorkflow($name: String!, $org_id: uuid!) {
    insert_workflows_one(object: { name: $name, org_id: $org_id }) {
      id
      name
    }
  }
`;

const DELETE_WORKFLOW = gql`
  mutation DeleteWorkflow($id: uuid!) {
    delete_workflows_by_pk(id: $id) {
      id
    }
  }
`;

const SAVE_WORKFLOW_STEPS_TRIGGERS = gql`
  mutation SaveWorkflowStepsAndTriggers(
    $workflow_id: uuid!
    $steps: [workflow_steps_insert_input!]!
    $triggers: [workflow_triggers_insert_input!]!
  ) {
    delete_workflow_steps(where: { workflow_id: { _eq: $workflow_id } }) {
      affected_rows
    }
    delete_workflow_triggers(where: { workflow_id: { _eq: $workflow_id } }) {
      affected_rows
    }
    insert_workflow_steps(objects: $steps) {
      affected_rows
    }
    insert_workflow_triggers(objects: $triggers) {
      affected_rows
    }
  }
`;

const TRIGGER_WORKFLOW_RUN = gql`
  mutation TriggerWorkflowRun($workflow_id: uuid!, $payload: jsonb) {
    triggerWorkflowRun(workflow_id: $workflow_id, payload: $payload) {
      workflow_run_id
      status
    }
  }
`;

const APPROVE_STEP = gql`
  mutation ApproveStep($step_run_id: uuid!) {
    approveStep(step_run_id: $step_run_id) {
      success
      status
    }
  }
`;

const GET_ORG_MEMBERS = gql`
  query GetOrgMembers($org_id: uuid!) {
    org_members(where: { org_id: { _eq: $org_id } }) {
      id
      user_id
      role
      created_at
    }
  }
`;

const ADD_ORG_MEMBER = gql`
  mutation AddOrgMember($org_id: uuid!, $user_id: uuid!, $role: String!) {
    insert_org_members_one(object: { org_id: $org_id, user_id: $user_id, role: $role }) {
      id
    }
  }
`;

const REMOVE_ORG_MEMBER = gql`
  mutation RemoveOrgMember($id: uuid!) {
    delete_org_members_by_pk(id: $id) {
      id
    }
  }
`;

// Live monitor of workflow step executions
const WATCH_STEP_RUNS = gql`
  subscription WatchStepRuns($run_id: uuid!) {
    workflow_runs_by_pk(id: $run_id) {
      id
      status
      step_runs(order_by: { created_at: asc }) {
        id
        step_id
        status
        input
        output
        error
        attempt_count
        approved_by
        approved_at
      }
    }
  }
`;

// ==========================================
// Types and Constants
// ==========================================

const STEP_TYPES = [
  { type: 'llm_call', label: 'LLM Call', icon: Cpu, desc: 'Call Gemini API' },
  { type: 'http_request', label: 'HTTP Request', icon: Globe, desc: 'Perform external HTTP request' },
  { type: 'db_write', label: 'Database Write', icon: Database, desc: 'Save context to database' },
  { type: 'notify', label: 'Notify Alert', icon: Bell, desc: 'Dispatches Event Trigger Notification' },
  { type: 'conditional_branch', label: 'Conditional Branch', icon: AlertTriangle, desc: 'Evaluate if/else logic' },
  { type: 'approval_gate', label: 'Approval Gate', icon: Pause, desc: 'Halts run awaiting owner/editor approval' }
];

export default function Dashboard() {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950 text-slate-100">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="h-10 w-10 animate-spin text-indigo-500" />
          <p className="text-slate-400 text-sm font-semibold">Loading workspace...</p>
        </div>
      </div>
    );
  }

  return <DashboardContent />;
}

function DashboardContent() {
  const router = useRouter();
  const userId = useUserId();
  const { signOut } = useSignOut();
  const { isAuthenticated, isLoading: authLoading } = useAuthenticationStatus();

  // Navigation / Active View States
  const [activeOrgId, setActiveOrgId] = useState<string>('');
  const [activeWorkflowId, setActiveWorkflowId] = useState<string>('');
  const [newOrgName, setNewOrgName] = useState('');
  const [newWorkflowName, setNewWorkflowName] = useState('');
  
  // Tab views
  const [currentTab, setCurrentTab] = useState<'workflows' | 'members' | 'stats'>('workflows');

  // Workflow builder details
  const [workflowSteps, setWorkflowSteps] = useState<any[]>([]);
  const [triggerType, setTriggerType] = useState<string>('manual');
  const [selectedStepIndex, setSelectedStepIndex] = useState<number | null>(null);

  // Active Run States
  const [activeRunId, setActiveRunId] = useState<string>('');
  const [testPayload, setTestPayload] = useState<string>('{\n  "input": "This is a bad refund review"\n}');

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, authLoading, router]);

  // Load User Orgs
  const { data: orgsData, refetch: refetchOrgs } = useQuery(GET_USER_ORGS, { skip: !isAuthenticated });
  const orgMemberships = orgsData?.org_members || [];
  const selectedMembership = orgMemberships.find((m: any) => m.org.id === activeOrgId);
  const userRoleInActiveOrg = selectedMembership?.role || 'viewer';

  // Set default active org
  useEffect(() => {
    if (orgMemberships.length > 0 && !activeOrgId) {
      setActiveOrgId(orgMemberships[0].org.id);
    }
  }, [orgMemberships, activeOrgId]);

  // Fetch Workflows
  const { data: workflowsData, refetch: refetchWorkflows } = useQuery(GET_WORKFLOWS, {
    variables: { org_id: activeOrgId },
    skip: !activeOrgId
  });
  const workflows = workflowsData?.workflows || [];
  const activeWorkflow = workflows.find((w: any) => w.id === activeWorkflowId);

  // Load active workflow into builder when selected
  useEffect(() => {
    if (activeWorkflow) {
      setWorkflowSteps(activeWorkflow.steps.map((s: any) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        config: s.config,
        position: s.position
      })));
      setTriggerType(activeWorkflow.triggers?.[0]?.type || 'manual');
      setSelectedStepIndex(null);
    } else {
      setWorkflowSteps([]);
      setTriggerType('manual');
      setSelectedStepIndex(null);
    }
  }, [activeWorkflowId, activeWorkflow]);

  // Fetch Org stats
  const { data: statsData, refetch: refetchStats } = useQuery(GET_ORG_STATS, {
    variables: { org_id: activeOrgId },
    skip: !activeOrgId
  });
  const orgStats = statsData?.org_usage_stats_by_pk || { quota_limit: 100, quota_used: 0 };

  // Fetch members
  const { data: membersData, refetch: refetchMembers } = useQuery(GET_ORG_MEMBERS, {
    variables: { org_id: activeOrgId },
    skip: !activeOrgId || currentTab !== 'members'
  });
  const orgMembers = membersData?.org_members || [];

  // ==========================================
  // Mutations
  // ==========================================

  const [createOrg, { loading: creatingOrg }] = useMutation(CREATE_ORG);
  const [createWorkflow, { loading: creatingWorkflow }] = useMutation(CREATE_WORKFLOW);
  const [deleteWorkflow] = useMutation(DELETE_WORKFLOW);
  const [saveWorkflowStepsAndTriggers, { loading: savingWorkflow }] = useMutation(SAVE_WORKFLOW_STEPS_TRIGGERS);
  const [triggerWorkflowRun, { loading: triggeringRun }] = useMutation(TRIGGER_WORKFLOW_RUN);
  const [approveStep] = useMutation(APPROVE_STEP);
  const [addOrgMember] = useMutation(ADD_ORG_MEMBER);
  const [removeOrgMember] = useMutation(REMOVE_ORG_MEMBER);

  // ==========================================
  // Subscriptions (Execution Monitor)
  // ==========================================

  const { data: subscriptionData } = useSubscription(WATCH_STEP_RUNS, {
    variables: { run_id: activeRunId },
    skip: !activeRunId
  });

  const activeRun = subscriptionData?.workflow_runs_by_pk;

  // ==========================================
  // Handlers
  // ==========================================

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrgName.trim()) return;
    try {
      const res = await createOrg({ variables: { name: newOrgName, user_id: userId } });
      const newId = res.data.insert_organizations_one.id;
      setNewOrgName('');
      await refetchOrgs();
      setActiveOrgId(newId);
    } catch (err) {
      alert('Error creating organization: ' + err);
    }
  };

  const handleCreateWorkflow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkflowName.trim()) return;
    try {
      const res = await createWorkflow({ variables: { name: newWorkflowName, org_id: activeOrgId } });
      const newId = res.data.insert_workflows_one.id;
      setNewWorkflowName('');
      await refetchWorkflows();
      setActiveWorkflowId(newId);
    } catch (err) {
      alert('Error creating workflow: ' + err);
    }
  };

  const handleDeleteWorkflow = async (id: string) => {
    if (!confirm('Are you sure you want to delete this workflow?')) return;
    try {
      await deleteWorkflow({ variables: { id } });
      if (activeWorkflowId === id) setActiveWorkflowId('');
      await refetchWorkflows();
    } catch (err) {
      alert('Error deleting workflow: ' + err);
    }
  };

  const handleSaveWorkflow = async () => {
    if (!activeWorkflowId) return;
    try {
      const stepsPayload = workflowSteps.map((s, idx) => ({
        workflow_id: activeWorkflowId,
        name: s.name,
        type: s.type,
        config: s.config,
        position: idx + 1
      }));

      const triggersPayload = [{
        workflow_id: activeWorkflowId,
        type: triggerType,
        config: {}
      }];

      await saveWorkflowStepsAndTriggers({
        variables: {
          workflow_id: activeWorkflowId,
          steps: stepsPayload,
          triggers: triggersPayload
        }
      });
      alert('Workflow saved successfully!');
      refetchWorkflows();
    } catch (err: any) {
      alert('Error saving workflow:\n' + err.message);
    }
  };

  const handleRunWorkflow = async () => {
    if (!activeWorkflowId) return;
    try {
      let parsedPayload = {};
      try {
        parsedPayload = JSON.parse(testPayload);
      } catch (err) {
        alert('Invalid JSON input payload');
        return;
      }

      const res = await triggerWorkflowRun({
        variables: {
          workflow_id: activeWorkflowId,
          payload: parsedPayload
        }
      });
      const newRunId = res.data.triggerWorkflowRun.workflow_run_id;
      setActiveRunId(newRunId);
      refetchStats();
    } catch (err: any) {
      alert('Error triggering run:\n' + err.message);
    }
  };

  const handleApproveStep = async (stepRunId: string) => {
    try {
      const res = await approveStep({ variables: { step_run_id: stepRunId } });
      if (res.data.approveStep.success) {
        alert('Step approved! Resuming execution...');
      }
    } catch (err: any) {
      alert('Error approving step:\n' + err.message);
    }
  };

  const [memberUserId, setMemberUserId] = useState('');
  const [memberRole, setMemberRole] = useState('viewer');

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberUserId.trim()) return;
    try {
      await addOrgMember({
        variables: {
          org_id: activeOrgId,
          user_id: memberUserId,
          role: memberRole
        }
      });
      setMemberUserId('');
      refetchMembers();
      alert('Member added successfully!');
    } catch (err: any) {
      alert('Error adding member: ' + err.message);
    }
  };

  const handleRemoveMember = async (id: string) => {
    if (!confirm('Are you sure you want to remove this member?')) return;
    try {
      await removeOrgMember({ variables: { id } });
      refetchMembers();
    } catch (err: any) {
      alert('Error removing member: ' + err.message);
    }
  };

  // Helper step builder editors
  const addStep = (type: string) => {
    const sType = STEP_TYPES.find(t => t.type === type);
    const newStep = {
      name: `${sType?.label}_${workflowSteps.length + 1}`.replace(/\s+/g, '_'),
      type,
      config: type === 'llm_call' ? { prompt: 'Analyze sentiment for: {{input}}' } :
              type === 'http_request' ? { url: 'https://httpbin.org/post', method: 'POST', body: { text: '{{steps.Sentiment_Analysis.output.text}}' } } :
              type === 'db_write' ? { payload: { alert: 'Review needs attention', context: '{{steps.Sentiment_Analysis.output.text}}' } } :
              type === 'notify' ? { message: 'Alert! Review has negative sentiment: {{steps.Sentiment_Analysis.output.text}}' } :
              type === 'conditional_branch' ? { expression: '{{steps.Sentiment_Analysis.output.text}}', operator: 'contains', target_value: 'negative', else_step_position: 6 } : {},
      position: workflowSteps.length + 1
    };
    setWorkflowSteps([...workflowSteps, newStep]);
    setSelectedStepIndex(workflowSteps.length);
  };

  const removeStep = (index: number) => {
    const updated = [...workflowSteps];
    updated.splice(index, 1);
    // Recalculate positions
    const corrected = updated.map((s, idx) => ({ ...s, position: idx + 1 }));
    setWorkflowSteps(corrected);
    setSelectedStepIndex(null);
  };

  const moveStep = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === workflowSteps.length - 1) return;
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    const updated = [...workflowSteps];
    const temp = updated[index];
    updated[index] = updated[targetIdx];
    updated[targetIdx] = temp;

    const corrected = updated.map((s, idx) => ({ ...s, position: idx + 1 }));
    setWorkflowSteps(corrected);
    setSelectedStepIndex(targetIdx);
  };

  const updateStepConfig = (key: string, value: any) => {
    if (selectedStepIndex === null) return;
    const updated = [...workflowSteps];
    updated[selectedStepIndex] = {
      ...updated[selectedStepIndex],
      config: {
        ...updated[selectedStepIndex].config,
        [key]: value
      }
    };
    setWorkflowSteps(updated);
  };

  const updateStepName = (name: string) => {
    if (selectedStepIndex === null) return;
    const updated = [...workflowSteps];
    updated[selectedStepIndex] = {
      ...updated[selectedStepIndex],
      name: name.replace(/\s+/g, '_')
    };
    setWorkflowSteps(updated);
  };

  if (authLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950 text-slate-100">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="h-10 w-10 animate-spin text-indigo-500" />
          <p className="text-slate-400 text-sm font-semibold">Authenticating...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden">
      
      {/* Sidebar - Organization Selector & Workflows list */}
      <aside className="w-80 bg-slate-900 border-r border-slate-800 flex flex-col flex-shrink-0">
        
        {/* User Info / Sign Out */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <User className="h-5 w-5 text-indigo-400" />
            <span className="text-xs text-slate-300 truncate max-w-[150px]" title={userId}>{userId}</span>
          </div>
          <button
            onClick={() => signOut()}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors cursor-pointer"
            title="Sign Out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>

        {/* Organization switcher */}
        <div className="p-4 border-b border-slate-800 space-y-3">
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
              Active Organization
            </label>
            <select
              value={activeOrgId}
              onChange={(e) => {
                setActiveOrgId(e.target.value);
                setActiveWorkflowId('');
                setActiveRunId('');
              }}
              className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
            >
              {orgMemberships.map((m: any) => (
                <option key={m.org.id} value={m.org.id}>
                  {m.org.name} ({m.role})
                </option>
              ))}
            </select>
          </div>

          {/* Create Organization Form */}
          <form onSubmit={handleCreateOrg} className="flex gap-2">
            <input
              type="text"
              required
              placeholder="New Org Name..."
              value={newOrgName}
              onChange={(e) => setNewOrgName(e.target.value)}
              className="flex-1 rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={creatingOrg}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
            </button>
          </form>
        </div>

        {/* Tabs for Workflows / Members / Stats */}
        <div className="flex border-b border-slate-800 text-xs font-semibold">
          <button
            onClick={() => setCurrentTab('workflows')}
            className={`flex-1 py-3 text-center border-b-2 transition-all cursor-pointer ${
              currentTab === 'workflows' 
                ? 'border-indigo-500 text-indigo-400' 
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Workflows
          </button>
          <button
            onClick={() => setCurrentTab('members')}
            className={`flex-1 py-3 text-center border-b-2 transition-all cursor-pointer ${
              currentTab === 'members' 
                ? 'border-indigo-500 text-indigo-400' 
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Members
          </button>
          <button
            onClick={() => setCurrentTab('stats')}
            className={`flex-1 py-3 text-center border-b-2 transition-all cursor-pointer ${
              currentTab === 'stats' 
                ? 'border-indigo-500 text-indigo-400' 
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Usage
          </button>
        </div>

        {/* Sidebar dynamic content */}
        <div className="flex-1 overflow-y-auto">
          {currentTab === 'workflows' && (
            <div className="p-4 space-y-4">
              
              {/* Workflows List */}
              <div className="space-y-1.5">
                <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  Workflows
                </label>
                {workflows.length === 0 ? (
                  <div className="text-center py-6 text-xs text-slate-500 italic">
                    No workflows created yet.
                  </div>
                ) : (
                  workflows.map((w: any) => (
                    <div
                      key={w.id}
                      onClick={() => {
                        setActiveWorkflowId(w.id);
                        setActiveRunId('');
                      }}
                      className={`group flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${
                        w.id === activeWorkflowId
                          ? 'bg-indigo-600/10 border-indigo-500/40 text-white'
                          : 'bg-slate-950/40 border-slate-800 hover:bg-slate-800/40 text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2 overflow-hidden">
                        <Workflow className={`h-4 w-4 ${w.id === activeWorkflowId ? 'text-indigo-400' : 'text-slate-500'}`} />
                        <span className="text-xs font-medium truncate">{w.name}</span>
                      </div>
                      
                      {/* Delete workflow button (Owner / Editor only) */}
                      {userRoleInActiveOrg !== 'viewer' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteWorkflow(w.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-all cursor-pointer"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* Create Workflow form */}
              {userRoleInActiveOrg !== 'viewer' && (
                <form onSubmit={handleCreateWorkflow} className="space-y-2 border-t border-slate-800/80 pt-4">
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                    New Workflow
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required
                      placeholder="Workflow name..."
                      value={newWorkflowName}
                      onChange={(e) => setNewWorkflowName(e.target.value)}
                      className="flex-1 rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                    />
                    <button
                      type="submit"
                      disabled={creatingWorkflow}
                      className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {currentTab === 'members' && (
            <div className="p-4 space-y-4">
              <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                Organization Members
              </label>

              {/* Members List */}
              <div className="space-y-2">
                {orgMembers.map((m: any) => (
                  <div key={m.id} className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950/40 border border-slate-850">
                    <div className="overflow-hidden flex-1 pr-2">
                      <p className="text-[10px] text-slate-300 truncate" title={m.user_id}>{m.user_id}</p>
                      <span className={`inline-block text-[8px] font-bold px-1.5 py-0.5 rounded-md mt-1 uppercase ${
                        m.role === 'owner' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                        m.role === 'editor' ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' :
                        'bg-slate-800 text-slate-400'
                      }`}>
                        {m.role}
                      </span>
                    </div>

                    {/* Only Owner can remove members, and cannot remove themselves */}
                    {userRoleInActiveOrg === 'owner' && m.user_id !== userId && (
                      <button
                        onClick={() => handleRemoveMember(m.id)}
                        className="p-1 text-slate-500 hover:text-red-400 rounded hover:bg-red-500/10 transition-colors cursor-pointer"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Add Member Form (Visible only to Owners) */}
              {userRoleInActiveOrg === 'owner' ? (
                <form onSubmit={handleAddMember} className="space-y-3 pt-4 border-t border-slate-800">
                  <div className="space-y-1">
                    <label className="block text-[9px] font-semibold text-slate-400">User UUID</label>
                    <input
                      type="text"
                      required
                      placeholder="Insert user ID (UUID)..."
                      value={memberUserId}
                      onChange={(e) => setMemberUserId(e.target.value)}
                      className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[9px] font-semibold text-slate-400">Role</label>
                    <select
                      value={memberRole}
                      onChange={(e) => setMemberRole(e.target.value)}
                      className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                    >
                      <option value="editor">Editor (Create, Trigger)</option>
                      <option value="viewer">Viewer (Read-only)</option>
                      <option value="owner">Owner (Full admin)</option>
                    </select>
                  </div>

                  <button
                    type="submit"
                    className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer transition-all"
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    Invite User
                  </button>
                </form>
              ) : (
                <div className="text-center py-4 text-xs text-slate-500 italic bg-slate-950/20 border border-dashed border-slate-800 rounded-lg">
                  Only owners can manage members.
                </div>
              )}
            </div>
          )}

          {currentTab === 'stats' && (
            <div className="p-4 space-y-5">
              <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                Usage Statistics
              </label>

              {/* Usage Quota Card */}
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400 font-medium">Quota Used</span>
                  <span className="text-xs font-bold text-white">
                    {orgStats.quota_used} / {orgStats.quota_limit} runs
                  </span>
                </div>
                
                {/* Progress bar */}
                <div className="h-2 w-full bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                  <div 
                    className={`h-full rounded-full transition-all duration-500 ${
                      (orgStats.quota_used / orgStats.quota_limit) > 0.9 ? 'bg-red-500' :
                      (orgStats.quota_used / orgStats.quota_limit) > 0.7 ? 'bg-amber-500' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${Math.min(100, (orgStats.quota_used / orgStats.quota_limit) * 100)}%` }}
                  />
                </div>

                <p className="text-[10px] text-slate-500 leading-normal">
                  Workflow limits reset monthly. Automated and manual runs share this quota limit.
                </p>
              </div>

              {/* Total Runs statistics */}
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="p-3 rounded-lg bg-slate-950/40 border border-slate-850">
                  <p className="text-[10px] text-slate-400 font-semibold mb-0.5">Total Executed</p>
                  <p className="text-xl font-bold text-white">{orgStats.total_runs || 0}</p>
                </div>
                <div className="p-3 rounded-lg bg-slate-950/40 border border-slate-850">
                  <p className="text-[10px] text-slate-400 font-semibold mb-0.5">Success Rate</p>
                  <p className="text-xl font-bold text-emerald-400">
                    {orgStats.total_runs 
                      ? `${Math.round(((orgStats.completed_runs || 0) / orgStats.total_runs) * 100)}%` 
                      : '0%'
                    }
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-slate-950/40 border border-slate-850">
                  <p className="text-[10px] text-slate-400 font-semibold mb-0.5">Failed Runs</p>
                  <p className="text-xl font-bold text-red-450">{orgStats.failed_runs || 0}</p>
                </div>
                <div className="p-3 rounded-lg bg-slate-950/40 border border-slate-850">
                  <p className="text-[10px] text-slate-400 font-semibold mb-0.5">Avg Duration</p>
                  <p className="text-sm font-bold text-indigo-400 mt-1">
                    {orgStats.avg_duration_seconds ? `${orgStats.avg_duration_seconds.toFixed(1)}s` : '0s'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Main Workspace (Builder + Real-time execution logger) */}
      <main className="flex-1 flex overflow-hidden">
        {activeWorkflowId ? (
          <div className="flex-1 flex overflow-hidden">
            
            {/* Left Column: Step List and Setup */}
            <div className="w-1/2 flex flex-col border-r border-slate-800 bg-slate-950/40 overflow-hidden">
              
              {/* Header bar */}
              <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/40">
                <div>
                  <h1 className="text-base font-bold text-white flex items-center gap-2">
                    <Workflow className="h-5 w-5 text-indigo-500" />
                    {activeWorkflow?.name}
                  </h1>
                  <p className="text-[10px] text-slate-400">
                    Manage steps, triggers, and configurations.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {/* Select trigger */}
                  <div className="flex items-center gap-1.5 mr-2">
                    <span className="text-[10px] text-slate-400 font-bold uppercase">Trigger:</span>
                    <select
                      value={triggerType}
                      disabled={userRoleInActiveOrg === 'viewer'}
                      onChange={(e) => setTriggerType(e.target.value)}
                      className="rounded bg-slate-900 border border-slate-800 text-[11px] font-semibold text-white px-2 py-1 focus:outline-none"
                    >
                      <option value="manual">Manual Button</option>
                      <option value="db_event">Watched Row Event</option>
                    </select>
                  </div>

                  {userRoleInActiveOrg !== 'viewer' && (
                    <button
                      onClick={handleSaveWorkflow}
                      disabled={savingWorkflow}
                      className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer transition-colors shadow-md shadow-indigo-600/10"
                    >
                      {savingWorkflow ? 'Saving...' : 'Save'}
                    </button>
                  )}
                </div>
              </div>

              {/* Steps Layout */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                
                {/* Node adding dock (Only for Owners/Editors) */}
                {userRoleInActiveOrg !== 'viewer' && (
                  <div className="space-y-2">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      Add Workflow Step
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {STEP_TYPES.map((st) => {
                        const StepIcon = st.icon;
                        const isRestricted = ['db_write', 'notify'].includes(st.type);
                        const isAllowed = !isRestricted || userRoleInActiveOrg === 'owner';

                        return (
                          <button
                            key={st.type}
                            onClick={() => addStep(st.type)}
                            disabled={!isAllowed}
                            className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all cursor-pointer ${
                              isAllowed 
                                ? 'bg-slate-900/60 border-slate-800 hover:bg-slate-800 hover:border-slate-700 text-slate-200' 
                                : 'bg-slate-900/20 border-slate-900/40 text-slate-600 cursor-not-allowed'
                            }`}
                            title={!isAllowed ? "Requires Owner privileges (Layer 2 Gating)" : st.desc}
                          >
                            <StepIcon className={`h-5 w-5 mb-1.5 ${isAllowed ? 'text-indigo-400' : 'text-slate-700'}`} />
                            <span className="text-[10px] font-bold">{st.label}</span>
                            {isRestricted && (
                              <span className="text-[8px] font-semibold text-amber-500 mt-1 uppercase tracking-wider">
                                Owner Only
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Ordered Step List */}
                <div className="space-y-3 pt-4 border-t border-slate-900">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    Steps Pipeline
                  </label>

                  {workflowSteps.length === 0 ? (
                    <div className="text-center py-10 text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl bg-slate-900/20 italic">
                      Add a step from the selector above to build your pipeline.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {workflowSteps.map((step, idx) => {
                        const sTypeObj = STEP_TYPES.find(t => t.type === step.type);
                        const StepIcon = sTypeObj?.icon || Cpu;
                        const isSelected = idx === selectedStepIndex;

                        return (
                          <div
                            key={idx}
                            onClick={() => setSelectedStepIndex(idx)}
                            className={`flex items-center justify-between p-3.5 rounded-xl border cursor-pointer transition-all ${
                              isSelected
                                ? 'bg-slate-900 border-indigo-500/60 text-white shadow-lg'
                                : 'bg-slate-900/40 border-slate-850 hover:bg-slate-900/80 text-slate-300'
                            }`}
                          >
                            <div className="flex items-center gap-3 overflow-hidden">
                              <span className="flex h-5 w-5 items-center justify-center rounded bg-slate-950 border border-slate-800 text-[10px] font-bold text-slate-400">
                                {idx + 1}
                              </span>
                              <StepIcon className="h-4 w-4 text-indigo-400 flex-shrink-0" />
                              <div className="truncate">
                                <p className="text-xs font-semibold truncate">{step.name}</p>
                                <p className="text-[9px] text-slate-500 uppercase mt-0.5">{step.type.replace('_', ' ')}</p>
                              </div>
                            </div>

                            <div className="flex items-center gap-1">
                              {userRoleInActiveOrg !== 'viewer' && (
                                <>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); moveStep(idx, 'up'); }}
                                    disabled={idx === 0}
                                    className="p-1 rounded text-slate-500 hover:text-white hover:bg-slate-850 disabled:opacity-30 cursor-pointer"
                                  >
                                    <ArrowUp className="h-3 w-3" />
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); moveStep(idx, 'down'); }}
                                    disabled={idx === workflowSteps.length - 1}
                                    className="p-1 rounded text-slate-500 hover:text-white hover:bg-slate-850 disabled:opacity-30 cursor-pointer"
                                  >
                                    <ArrowDown className="h-3 w-3" />
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); removeStep(idx); }}
                                    className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 cursor-pointer"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

              </div>
            </div>

            {/* Middle Column: Step configuration details */}
            <div className="w-1/2 flex flex-col border-r border-slate-850 overflow-hidden bg-slate-950/20">
              {selectedStepIndex !== null && workflowSteps[selectedStepIndex] ? (
                <div className="flex-1 flex flex-col overflow-hidden">
                  
                  {/* Step Editor Header */}
                  <div className="p-4 border-b border-slate-850 bg-slate-900/30 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-white">
                        Configure: {workflowSteps[selectedStepIndex].name}
                      </h3>
                      <p className="text-[9px] text-slate-400 uppercase mt-0.5">
                        Type: {workflowSteps[selectedStepIndex].type.replace('_', ' ')}
                      </p>
                    </div>
                  </div>

                  {/* Config Form fields */}
                  <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
                    
                    {/* Rename step */}
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-bold text-slate-400 uppercase">Step Unique Name</label>
                      <input
                        type="text"
                        disabled={userRoleInActiveOrg === 'viewer'}
                        value={workflowSteps[selectedStepIndex].name}
                        onChange={(e) => updateStepName(e.target.value)}
                        className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3.5 py-2.5 text-white font-medium focus:border-indigo-500 focus:outline-none"
                      />
                      <span className="text-[9px] text-slate-500">Must be unique, no spaces allowed (use underscores). Use in other steps via `{`{steps.StepName.output...}`}`.</span>
                    </div>

                    {/* LLM Call configurations */}
                    {workflowSteps[selectedStepIndex].type === 'llm_call' && (
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <label className="block text-[10px] font-bold text-slate-400 uppercase">System / Prompt Instruction</label>
                          <textarea
                            rows={6}
                            disabled={userRoleInActiveOrg === 'viewer'}
                            value={workflowSteps[selectedStepIndex].config.prompt || ''}
                            onChange={(e) => updateStepConfig('prompt', e.target.value)}
                            className="w-full rounded-lg bg-slate-950 border border-slate-800 p-3 text-white font-mono text-xs focus:border-indigo-500 focus:outline-none leading-relaxed"
                            placeholder="Input your template instructions here..."
                          />
                        </div>
                      </div>
                    )}

                    {/* HTTP Request configurations */}
                    {workflowSteps[selectedStepIndex].type === 'http_request' && (
                      <div className="space-y-4">
                        <div className="space-y-1.5">
                          <label className="block text-[10px] font-bold text-slate-400 uppercase">Endpoint URL</label>
                          <input
                            type="text"
                            disabled={userRoleInActiveOrg === 'viewer'}
                            value={workflowSteps[selectedStepIndex].config.url || ''}
                            onChange={(e) => updateStepConfig('url', e.target.value)}
                            className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3.5 py-2.5 text-white font-mono focus:border-indigo-500 focus:outline-none"
                            placeholder="https://api.example.com/data"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <label className="block text-[10px] font-bold text-slate-400 uppercase">HTTP Method</label>
                            <select
                              disabled={userRoleInActiveOrg === 'viewer'}
                              value={workflowSteps[selectedStepIndex].config.method || 'GET'}
                              onChange={(e) => updateStepConfig('method', e.target.value)}
                              className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2.5 text-white focus:border-indigo-500 focus:outline-none"
                            >
                              <option value="GET">GET</option>
                              <option value="POST">POST</option>
                              <option value="PUT">PUT</option>
                              <option value="DELETE">DELETE</option>
                            </select>
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <label className="block text-[10px] font-bold text-slate-400 uppercase">Request Headers (JSON)</label>
                          <textarea
                            rows={3}
                            disabled={userRoleInActiveOrg === 'viewer'}
                            value={typeof workflowSteps[selectedStepIndex].config.headers === 'object' ? JSON.stringify(workflowSteps[selectedStepIndex].config.headers, null, 2) : workflowSteps[selectedStepIndex].config.headers || '{}'}
                            onChange={(e) => {
                              try {
                                const parsed = JSON.parse(e.target.value);
                                updateStepConfig('headers', parsed);
                              } catch (err) {
                                updateStepConfig('headers', e.target.value);
                              }
                            }}
                            className="w-full rounded-lg bg-slate-950 border border-slate-800 p-3 text-white font-mono text-xs focus:border-indigo-500 focus:outline-none"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <label className="block text-[10px] font-bold text-slate-400 uppercase">Request Body (JSON)</label>
                          <textarea
                            rows={4}
                            disabled={userRoleInActiveOrg === 'viewer'}
                            value={typeof workflowSteps[selectedStepIndex].config.body === 'object' ? JSON.stringify(workflowSteps[selectedStepIndex].config.body, null, 2) : workflowSteps[selectedStepIndex].config.body || '{}'}
                            onChange={(e) => {
                              try {
                                const parsed = JSON.parse(e.target.value);
                                updateStepConfig('body', parsed);
                              } catch (err) {
                                updateStepConfig('body', e.target.value);
                              }
                            }}
                            className="w-full rounded-lg bg-slate-950 border border-slate-800 p-3 text-white font-mono text-xs focus:border-indigo-500 focus:outline-none"
                          />
                        </div>
                      </div>
                    )}

                    {/* DB Write configurations */}
                    {workflowSteps[selectedStepIndex].type === 'db_write' && (
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <label className="block text-[10px] font-bold text-slate-400 uppercase">Payload to write (JSON)</label>
                          <textarea
                            rows={5}
                            disabled={userRoleInActiveOrg === 'viewer'}
                            value={typeof workflowSteps[selectedStepIndex].config.payload === 'object' ? JSON.stringify(workflowSteps[selectedStepIndex].config.payload, null, 2) : workflowSteps[selectedStepIndex].config.payload || '{}'}
                            onChange={(e) => {
                              try {
                                const parsed = JSON.parse(e.target.value);
                                updateStepConfig('payload', parsed);
                              } catch (err) {
                                updateStepConfig('payload', e.target.value);
                              }
                            }}
                            className="w-full rounded-lg bg-slate-950 border border-slate-800 p-3 text-white font-mono text-xs focus:border-indigo-500 focus:outline-none"
                          />
                        </div>
                      </div>
                    )}

                    {/* Notify configurations */}
                    {workflowSteps[selectedStepIndex].type === 'notify' && (
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <label className="block text-[10px] font-bold text-slate-400 uppercase">Message Text</label>
                          <textarea
                            rows={3}
                            disabled={userRoleInActiveOrg === 'viewer'}
                            value={workflowSteps[selectedStepIndex].config.message || ''}
                            onChange={(e) => updateStepConfig('message', e.target.value)}
                            className="w-full rounded-lg bg-slate-950 border border-slate-800 p-3 text-white focus:border-indigo-500 focus:outline-none"
                            placeholder="Type alert notification..."
                          />
                        </div>
                      </div>
                    )}

                    {/* Conditional Branch configurations */}
                    {workflowSteps[selectedStepIndex].type === 'conditional_branch' && (
                      <div className="space-y-4">
                        <div className="space-y-1.5">
                          <label className="block text-[10px] font-bold text-slate-400 uppercase">Expression / Source Value</label>
                          <input
                            type="text"
                            disabled={userRoleInActiveOrg === 'viewer'}
                            value={workflowSteps[selectedStepIndex].config.expression || ''}
                            onChange={(e) => updateStepConfig('expression', e.target.value)}
                            className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3.5 py-2.5 text-white font-mono focus:border-indigo-500 focus:outline-none"
                            placeholder="{{steps.LLM_Step.output.text}}"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <label className="block text-[10px] font-bold text-slate-400 uppercase">Operator</label>
                            <select
                              disabled={userRoleInActiveOrg === 'viewer'}
                              value={workflowSteps[selectedStepIndex].config.operator || 'equals'}
                              onChange={(e) => updateStepConfig('operator', e.target.value)}
                              className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2.5 text-white focus:border-indigo-500 focus:outline-none"
                            >
                              <option value="equals">Equals</option>
                              <option value="contains">Contains (Case Insensitive)</option>
                            </select>
                          </div>

                          <div className="space-y-1.5">
                            <label className="block text-[10px] font-bold text-slate-400 uppercase">Target Match Value</label>
                            <input
                              type="text"
                              disabled={userRoleInActiveOrg === 'viewer'}
                              value={workflowSteps[selectedStepIndex].config.target_value || ''}
                              onChange={(e) => updateStepConfig('target_value', e.target.value)}
                              className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2.5 text-white focus:border-indigo-500 focus:outline-none"
                              placeholder="negative"
                            />
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <label className="block text-[10px] font-bold text-slate-400 uppercase">Else Step Position (To Jump To)</label>
                          <input
                            type="number"
                            disabled={userRoleInActiveOrg === 'viewer'}
                            value={workflowSteps[selectedStepIndex].config.else_step_position || 1}
                            onChange={(e) => updateStepConfig('else_step_position', parseInt(e.target.value))}
                            className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3.5 py-2.5 text-white focus:border-indigo-500 focus:outline-none"
                            placeholder="6"
                          />
                        </div>
                      </div>
                    )}

                    {/* Approval Gate configurations */}
                    {workflowSteps[selectedStepIndex].type === 'approval_gate' && (
                      <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 text-center">
                        <Pause className="h-8 w-8 text-amber-500 mx-auto mb-2 animate-pulse" />
                        <p className="font-semibold text-white">Approval Gate Configured</p>
                        <p className="text-[10px] text-slate-400 leading-normal mt-1">
                          No properties required. When triggered, the engine suspends execution here. Only users with the Owner or Editor role can resume the run.
                        </p>
                      </div>
                    )}

                  </div>

                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-slate-500 text-center border-l border-slate-900 bg-slate-950/20">
                  <Settings className="h-8 w-8 text-slate-700 mb-2" />
                  <p className="text-xs italic">Select any step in the pipeline to edit its parameters.</p>
                </div>
              )}
            </div>

          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-500 p-8">
            <LayoutDashboard className="h-10 w-10 text-slate-800 mb-3" />
            <h3 className="text-sm font-semibold text-white mb-1">No Workflow Selected</h3>
            <p className="text-xs text-slate-400 max-w-sm text-center">
              Please choose a workflow from the sidebar tab or create a new one to initialize the pipeline editor workspace.
            </p>
          </div>
        )}

        {/* Right Execution Monitor Pane (Visible when activeRunId is set or trigger clicked) */}
        {activeWorkflowId && (
          <div className="w-96 border-l border-slate-800 bg-slate-900/60 flex flex-col overflow-hidden">
            
            {/* Monitor Header */}
            <div className="p-4 border-b border-slate-800 bg-slate-950/20 flex flex-col gap-3">
              <div>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Run Console</h3>
                <p className="text-[10px] text-slate-500">Trigger and trace executions in real-time.</p>
              </div>

              {/* Input test payload */}
              <div className="space-y-1.5">
                <label className="block text-[9px] font-bold text-slate-400 uppercase">Input Payload (JSON)</label>
                <textarea
                  rows={3}
                  value={testPayload}
                  onChange={(e) => setTestPayload(e.target.value)}
                  className="w-full rounded bg-slate-950 border border-slate-800 p-2 text-[10px] font-mono text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Trigger manual run */}
              <div className="flex gap-2">
                {userRoleInActiveOrg !== 'viewer' ? (
                  <button
                    onClick={handleRunWorkflow}
                    disabled={triggeringRun}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold cursor-pointer transition-colors shadow-lg shadow-emerald-600/10"
                  >
                    <Play className="h-3.5 w-3.5" />
                    Trigger Manual Run
                  </button>
                ) : (
                  <div className="flex-1 text-center py-2 bg-slate-950/30 border border-slate-800 rounded-lg text-slate-500 text-[10px] italic">
                    Viewers cannot trigger runs (Layer 1 RLS block).
                  </div>
                )}
              </div>
            </div>

            {/* Webhook trigger testing box */}
            {activeWorkflow && triggerType === 'db_event' && (
              <div className="p-3 border-b border-slate-800 bg-indigo-950/10 text-xs space-y-1.5">
                <p className="font-bold text-slate-300 text-[10px] uppercase">Test DB Event Trigger</p>
                <p className="text-[9px] text-slate-400 leading-normal">
                  To trigger this run automatically, insert a row in the <code className="text-indigo-300">public.watched_events</code> table matching this organization ID:
                </p>
                <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded text-[9px] border border-slate-850 font-mono text-indigo-400">
                  <span className="truncate flex-1">{activeOrgId}</span>
                  <button 
                    onClick={() => { navigator.clipboard.writeText(activeOrgId); alert('Copied Org ID!'); }}
                    className="text-slate-500 hover:text-white cursor-pointer"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
              </div>
            )}

            {/* Run steps timeline */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {activeRunId ? (
                <div className="space-y-4">
                  
                  {/* Status header banner */}
                  <div className="flex items-center justify-between p-3 rounded-lg bg-slate-950/50 border border-slate-850">
                    <div>
                      <p className="text-[10px] text-slate-500 font-semibold uppercase">Run status</p>
                      <h4 className={`text-xs font-bold uppercase mt-1 ${
                        activeRun?.status === 'completed' ? 'text-emerald-400 animate-pulse' :
                        activeRun?.status === 'failed' ? 'text-red-400' :
                        activeRun?.status === 'paused' ? 'text-amber-500' : 'text-indigo-400'
                      }`}>
                        {activeRun?.status || 'Initiating...'}
                      </h4>
                    </div>

                    {activeRun?.status === 'running' && (
                      <RefreshCw className="h-4 w-4 animate-spin text-indigo-400" />
                    )}
                    {activeRun?.status === 'paused' && (
                      <Pause className="h-4 w-4 text-amber-500 animate-pulse" />
                    )}
                  </div>

                  {/* Steps executed */}
                  <div className="space-y-3">
                    {activeRun?.step_runs?.map((sr: any, idx: number) => {
                      const matchedStep = workflowSteps.find(s => s.id === sr.step_id);
                      
                      return (
                        <div key={sr.id} className="p-3 rounded-xl border border-slate-800 bg-slate-950/20 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 overflow-hidden">
                              <span className="text-[10px] font-bold text-slate-400">
                                {idx + 1}.
                              </span>
                              <span className="text-xs font-semibold text-white truncate">
                                {matchedStep?.name || 'Step'}
                              </span>
                            </div>

                            <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                              sr.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' :
                              sr.status === 'failed' ? 'bg-red-500/10 text-red-400' :
                              sr.status === 'paused' ? 'bg-amber-500/10 text-amber-500 animate-pulse' :
                              'bg-indigo-500/10 text-indigo-400'
                            }`}>
                              {sr.status}
                            </span>
                          </div>

                          {/* Attempt count */}
                          {sr.attempt_count > 1 && (
                            <p className="text-[9px] text-slate-400 italic">
                              Attempt count: {sr.attempt_count}
                            </p>
                          )}

                          {/* Outputs */}
                          {sr.output && sr.status === 'completed' && (
                            <div className="bg-slate-950 p-2 rounded text-[9px] font-mono border border-slate-900 max-h-32 overflow-y-auto">
                              <p className="text-indigo-400 font-bold mb-1">Output:</p>
                              <pre className="text-slate-300 whitespace-pre-wrap">{JSON.stringify(sr.output, null, 2)}</pre>
                            </div>
                          )}

                          {/* Errors */}
                          {sr.error && sr.status === 'failed' && (
                            <div className="bg-red-950/15 border border-red-500/20 p-2.5 rounded text-[9px] font-mono text-red-400">
                              <p className="font-bold mb-1">Error message:</p>
                              <p className="leading-relaxed">{sr.error}</p>
                            </div>
                          )}

                          {/* Approval gating options */}
                          {sr.status === 'paused' && (
                            <div className="pt-2 border-t border-slate-800/80 space-y-2">
                              <p className="text-[9px] text-amber-500 leading-normal">
                                Execution halted. Resuming requires authorization.
                              </p>
                              
                              {userRoleInActiveOrg !== 'viewer' ? (
                                <button
                                  onClick={() => handleApproveStep(sr.id)}
                                  className="w-full py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-bold transition-all cursor-pointer shadow-lg shadow-amber-600/15"
                                >
                                  Approve & Resume Forward
                                </button>
                              ) : (
                                <div className="text-center py-1 border border-dashed border-amber-500/30 rounded text-[9px] italic text-slate-500">
                                  Viewers cannot approve step runs (Layer 2 gating).
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                </div>
              ) : (
                <div className="text-center py-20 text-xs text-slate-600 italic">
                  Run the workflow to watch the pipeline execute in real-time.
                </div>
              )}
            </div>

          </div>
        )}
      </main>

    </div>
  );
}
