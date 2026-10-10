import React, { useState, useRef } from 'react';
import {
  X,
  FolderKanban,
  Globe2,
  Layers,
  Plus,
  Check,
  Lock,
  Shield,
  Edit3,
  Clock,
  AlertCircle,
  CheckCircle2,
  Copy,
  Archive,
  RotateCcw,
  Trash2,
  Undo2,
  AlertTriangle,
  History,
  Download,
  Upload,
} from 'lucide-react';
import {
  useTacticalStore,
  selectAllScenarios,
  selectActiveScenario,
  selectActivePlan,
  selectAllPlansForActiveScenario,
  SCENARIO_STATUS_LABELS,
  PLAN_STATUS_LABELS,
  isPlanEligibleForPurge,
  isScenarioEligibleForPurge,
} from '../../store/useTacticalStore';

interface ConfirmDialogState {
  type:
    | 'propose_plan'
    | 'withdraw_plan'
    | 'trash_plan'
    | 'trash_scenario'
    | 'archive_scenario'
    | 'archive_plan'
    | 'purge_plan'
    | 'purge_scenario'
    | 'empty_trash'
    | 'import_workspace';
  targetId: string;
  targetName: string;
  contextInfo?: string;
  equipmentCount?: number;
  payload?: any;
  summary?: {
    eligiblePlans: any[];
    eligibleScenarios: any[];
    retainedPlans: { plan: any; reason: string }[];
    retainedScenarios: { scenario: any; reason: string }[];
  };
}

export const WorkspaceModal: React.FC = () => {
  const {
    showWorkspaceModal,
    setShowWorkspaceModal,
    workspaceModalTab,
    setWorkspaceModalTab,
    createScenario,
    switchScenario,
    renameScenario,
    archiveScenario,
    restoreScenario,
    trashDraftScenario,
    restoreDraftScenario,
    purgeTrashedScenario,
    createEmptyPlan,
    renamePlan,
    proposePlan,
    withdrawAndReviseProposedPlan,
    trashDraftPlan,
    restoreDraftPlan,
    purgeTrashedPlan,
    emptyTrash,
    getTrashSummary,
    archivePlan,
    restorePlan,
    switchActivePlan,
    createPlanAlternative,
    saveActivePlan,
    exportCanonicalPackageV2,
    importCanonicalPackage,
    definitions,
    placements,
  } = useTacticalStore();

  const allScenarios = useTacticalStore(selectAllScenarios);
  const activeScenario = useTacticalStore(selectActiveScenario);
  const activePlan = useTacticalStore(selectActivePlan);
  const allPlansInActiveScenario = useTacticalStore(selectAllPlansForActiveScenario);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Local UI filters & views
  const [scenarioFilter, setScenarioFilter] = useState<'active' | 'archived' | 'trashed'>('active');
  const [planFilter, setPlanFilter] = useState<'active' | 'history' | 'archived' | 'trashed'>('active');
  const [expandedWithdrawnPlanId, setExpandedWithdrawnPlanId] = useState<string | null>(null);

  // Form states
  const [newScenarioName, setNewScenarioName] = useState('');
  const [newScenarioTerrain, setNewScenarioTerrain] = useState('v1');
  const [showCreateScenarioForm, setShowCreateScenarioForm] = useState(false);

  const [newPlanName, setNewPlanName] = useState('');
  const [showCreatePlanForm, setShowCreatePlanForm] = useState(false);

  const [editingScenarioId, setEditingScenarioId] = useState<string | null>(null);
  const [editingScenarioName, setEditingScenarioName] = useState('');

  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [editingPlanName, setEditingPlanName] = useState('');

  // Confirmation & reason dialog
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [withdrawReasonInput, setWithdrawReasonInput] = useState('');

  const [notification, setNotification] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  if (!showWorkspaceModal) return null;

  const showToast = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4000);
  };

  // Filtered lists
  const filteredScenarios = allScenarios.filter((s) => {
    if (scenarioFilter === 'active') return s.status === 'draft' || s.status === 'active';
    if (scenarioFilter === 'archived') return s.status === 'archived';
    if (scenarioFilter === 'trashed') return s.status === 'trashed';
    return true;
  });

  const filteredPlans = allPlansInActiveScenario.filter((p) => {
    if (planFilter === 'active') return p.status === 'draft' || p.status === 'proposed' || p.status === 'approved';
    if (planFilter === 'history') return p.status === 'withdrawn';
    if (planFilter === 'archived') return p.status === 'archived';
    if (planFilter === 'trashed') return p.status === 'trashed';
    return true;
  });

  const isScenarioEligibleForTrash = (scenarioId: string) => {
    const childPlans = Object.values(useTacticalStore.getState().plans).filter((p) => p.scenarioId === scenarioId);
    const hasProtectedPlans = childPlans.some(
      (p) => p.status === 'proposed' || p.status === 'approved' || p.status === 'withdrawn' || p.status === 'archived'
    );
    const hasSimRuns = Object.values(useTacticalStore.getState().simulationRuns).some((r) => r.scenarioId === scenarioId);
    return !hasProtectedPlans && !hasSimRuns;
  };

  const handleExportV2 = () => {
    try {
      const pkg = exportCanonicalPackageV2('Workspace Backup V2');
      const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `workspace-canonical-v2-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      const auditCount = Object.keys(pkg.auditEvents || {}).length;
      const scenariosCount = Object.keys(pkg.scenarios || {}).length;
      const plansCount = Object.keys(pkg.plans || {}).length;
      showToast(
        'success',
        `Đã xuất gói Workspace V2 toàn vẹn (${scenariosCount} kịch bản, ${plansCount} phương án, ${auditCount} audit events).`
      );
    } catch (err: any) {
      showToast('error', err?.message || 'Lỗi khi xuất gói Workspace V2.');
    }
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const parsed = JSON.parse(content);
        if (!parsed || typeof parsed !== 'object') {
          throw new Error('Định dạng tệp JSON không hợp lệ.');
        }
        const schemaVer = parsed.schemaVersion || 1;
        const scenariosCount = Object.keys(parsed.scenarios || {}).length;
        const plansCount = Object.keys(parsed.plans || {}).length;
        const auditCount = Object.keys(parsed.auditEvents || {}).length;

        setConfirmDialog({
          type: 'import_workspace',
          targetId: 'workspace-import',
          targetName: file.name,
          contextInfo: `Gói Workspace Chuẩn Schema V${schemaVer} (${scenariosCount} kịch bản, ${plansCount} phương án, ${auditCount} sự kiện kiểm toán).`,
          payload: parsed,
        });
      } catch (err: any) {
        showToast('error', `Lỗi khi đọc tệp Workspace: ${err?.message || 'Tệp JSON không hợp lệ'}`);
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  // Handlers
  const handleCreateScenario = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newScenarioName.trim()) {
      showToast('error', 'Tên kịch bản không được để trống.');
      return;
    }
    try {
      createScenario(newScenarioName.trim(), newScenarioTerrain);
      showToast('success', `Đã tạo kịch bản mới: "${newScenarioName.trim()}" kèm phương án gốc.`);
      setNewScenarioName('');
      setShowCreateScenarioForm(false);
      setWorkspaceModalTab('plans');
    } catch (err: any) {
      showToast('error', err?.message || 'Lỗi khi tạo kịch bản.');
    }
  };

  const handleRenameScenario = (scenarioId: string) => {
    if (!editingScenarioName.trim()) {
      showToast('error', 'Tên kịch bản không được để trống.');
      return;
    }
    try {
      renameScenario(scenarioId, editingScenarioName.trim());
      showToast('success', 'Đã đổi tên kịch bản thành công.');
      setEditingScenarioId(null);
      setEditingScenarioName('');
    } catch (err: any) {
      showToast('error', err?.message || 'Lỗi khi đổi tên kịch bản.');
    }
  };

  const handleCreateEmptyPlan = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlanName.trim()) {
      showToast('error', 'Tên phương án không được để trống.');
      return;
    }
    try {
      createEmptyPlan(newPlanName.trim());
      showToast('success', `Đã tạo phương án mới: "${newPlanName.trim()}".`);
      setNewPlanName('');
      setShowCreatePlanForm(false);
    } catch (err: any) {
      showToast('error', err?.message || 'Lỗi khi tạo phương án mới.');
    }
  };

  const handleRenamePlan = (planId: string) => {
    if (!editingPlanName.trim()) {
      showToast('error', 'Tên phương án không được để trống.');
      return;
    }
    try {
      renamePlan(planId, editingPlanName.trim());
      showToast('success', 'Đã đổi tên phương án thành công.');
      setEditingPlanId(null);
      setEditingPlanName('');
    } catch (err: any) {
      showToast('error', err?.message || 'Lỗi khi đổi tên phương án.');
    }
  };

  const handleClonePlan = (sourcePlanId?: string) => {
    try {
      createPlanAlternative(sourcePlanId);
      showToast('success', 'Đã tạo phương án thay thế mới thành công.');
    } catch (err: any) {
      showToast('error', err?.message || 'Lỗi khi tạo phương án thay thế.');
    }
  };

  const handleValidatePlan = () => {
    try {
      saveActivePlan();
      showToast('success', 'Đồ thị phương án hoàn toàn hợp lệ và toàn vẹn!');
    } catch (err: any) {
      showToast('error', err?.message || 'Phương án có lỗi vi phạm tính toàn vẹn đồ thị.');
    }
  };

  const handleOpenEmptyTrashDialog = (scope: 'all' | 'plans' | 'scenarios') => {
    const summary = getTrashSummary(scope);
    const totalEligible = summary.eligiblePlans.length + summary.eligibleScenarios.length;
    const totalRetained = summary.retainedPlans.length + summary.retainedScenarios.length;
    if (totalEligible === 0 && totalRetained === 0) {
      showToast('error', 'Thùng rác hiện đang trống.');
      return;
    }
    setConfirmDialog({
      type: 'empty_trash',
      targetId: scope,
      targetName:
        scope === 'plans'
          ? 'Thùng rác Phương án'
          : scope === 'scenarios'
          ? 'Thùng rác Kịch bản'
          : 'Toàn bộ Thùng rác',
      summary,
    });
  };

  // Execution of confirmed actions
  const handleExecuteConfirmedAction = () => {
    if (!confirmDialog) return;
    try {
      if (confirmDialog.type === 'propose_plan') {
        proposePlan(confirmDialog.targetId);
        showToast('success', `Phương án "${confirmDialog.targetName}" đã được đề xuất xét duyệt và đóng băng.`);
      } else if (confirmDialog.type === 'withdraw_plan') {
        if (!withdrawReasonInput.trim()) {
          showToast('error', 'Bắt buộc nhập lý do thu hồi phương án.');
          return;
        }
        const newRevisionId = withdrawAndReviseProposedPlan(confirmDialog.targetId, withdrawReasonInput.trim());
        showToast(
          'success',
          `Đã thu hồi phương án "${confirmDialog.targetName}" và tạo bản dự thảo mới (Mã: ${newRevisionId}). Bạn có thể bổ sung khí tài và gửi xét duyệt lại.`
        );
        setWithdrawReasonInput('');
      } else if (confirmDialog.type === 'trash_plan') {
        trashDraftPlan(confirmDialog.targetId);
        showToast('success', `Đã chuyển phương án "${confirmDialog.targetName}" vào thùng rác.`);
      } else if (confirmDialog.type === 'archive_scenario') {
        archiveScenario(confirmDialog.targetId);
        showToast('success', `Đã lưu trữ kịch bản "${confirmDialog.targetName}".`);
      } else if (confirmDialog.type === 'trash_scenario') {
        trashDraftScenario(confirmDialog.targetId);
        showToast('success', `Đã chuyển kịch bản "${confirmDialog.targetName}" vào thùng rác.`);
      } else if (confirmDialog.type === 'archive_plan') {
        archivePlan(confirmDialog.targetId);
        showToast('success', `Đã lưu trữ phương án "${confirmDialog.targetName}".`);
      } else if (confirmDialog.type === 'purge_plan') {
        purgeTrashedPlan(confirmDialog.targetId);
        showToast('success', `Đã xóa vĩnh viễn phương án "${confirmDialog.targetName}".`);
      } else if (confirmDialog.type === 'purge_scenario') {
        purgeTrashedScenario(confirmDialog.targetId);
        showToast('success', `Đã xóa vĩnh viễn kịch bản "${confirmDialog.targetName}".`);
      } else if (confirmDialog.type === 'empty_trash') {
        const res = emptyTrash((confirmDialog.targetId as any) || 'all');
        const totalPurged = res.purgedPlans.length + res.purgedScenarios.length;
        const totalRetained = res.retainedPlans.length + res.retainedScenarios.length;
        if (totalPurged > 0) {
          showToast(
            'success',
            `Đã dọn dẹp ${totalPurged} mục trong Thùng rác (${res.purgedPlans.length} phương án, ${res.purgedScenarios.length} kịch bản).${
              totalRetained > 0 ? ` Giữ lại ${totalRetained} mục có ràng buộc lịch sử.` : ''
            }`
          );
        } else {
          showToast(
            'error',
            `Không có mục nào được dọn dẹp. Giữ lại ${totalRetained} mục có ràng buộc lịch sử.`
          );
        }
      } else if (confirmDialog.type === 'import_workspace') {
        if (!confirmDialog.payload) {
          throw new Error('Không tìm thấy dữ liệu gói Workspace hợp lệ.');
        }
        importCanonicalPackage(confirmDialog.payload);
        const schemaVer = confirmDialog.payload.schemaVersion || 1;
        showToast('success', `Đã nạp thành công gói dữ liệu Workspace (Chuẩn Schema V${schemaVer}).`);
      }
    } catch (err: any) {
      showToast('error', err?.message || 'Thao tác không thành công.');
    } finally {
      setConfirmDialog(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl bg-slate-950/95 border border-cyan-800/60 rounded-2xl shadow-[0_0_50px_rgba(6,182,212,0.25)] flex flex-col overflow-hidden max-h-[85vh]">
        {/* Header Modal */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-cyan-900/40 bg-slate-900/60 shrink-0 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-950/80 border border-cyan-500/50 flex items-center justify-center text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.3)]">
              <FolderKanban className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100 font-mono tracking-wide flex items-center gap-2">
                KHÔNG GIAN TÁC CHIẾN
              </h2>
              <p className="text-xs text-slate-400">
                Quản lý kịch bản và phương án bố trí
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportV2}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-cyan-950/90 hover:bg-cyan-900 border border-cyan-500/50 text-cyan-300 transition-all cursor-pointer shadow-sm"
              title="Xuất bản sao lưu toàn bộ Không gian tác chiến"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              <span>Xuất</span>
            </button>
            <label
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-slate-600 text-slate-200 transition-all cursor-pointer shadow-sm"
              title="Nhập gói dữ liệu Không gian tác chiến"
            >
              <Upload className="w-3.5 h-3.5 text-cyan-400" />
              <span>Nhập</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={handleImportFile}
              />
            </label>
            <button
              onClick={() => setShowWorkspaceModal(false)}
              className="w-8 h-8 rounded-lg bg-slate-900/80 border border-slate-700/60 text-slate-400 hover:text-white hover:border-slate-500 flex items-center justify-center transition-all cursor-pointer ml-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Thông báo phản hồi */}
        {notification && (
          <div
            className={`px-5 py-2.5 text-xs font-medium flex items-center gap-2 transition-all shrink-0 ${
              notification.type === 'success'
                ? 'bg-emerald-950/90 text-emerald-300 border-b border-emerald-500/40'
                : 'bg-rose-950/90 text-rose-300 border-b border-rose-500/40'
            }`}
          >
            {notification.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{notification.message}</span>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800 bg-slate-900/40 px-6 pt-3 gap-2 shrink-0">
          <button
            onClick={() => setWorkspaceModalTab('scenarios')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-t-lg transition-all border-b-2 cursor-pointer ${
              workspaceModalTab === 'scenarios'
                ? 'bg-slate-900 text-cyan-300 border-cyan-400 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-900/30'
            }`}
          >
            <Globe2 className="w-4 h-4 text-cyan-400" />
            <span>Kịch Bản Tác Chiến ({allScenarios.length})</span>
          </button>
          <button
            onClick={() => setWorkspaceModalTab('plans')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-t-lg transition-all border-b-2 cursor-pointer ${
              workspaceModalTab === 'plans'
                ? 'bg-slate-900 text-cyan-300 border-cyan-400 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-900/30'
            }`}
          >
            <Layers className="w-4 h-4 text-cyan-400" />
            <span>
              Phương Án Bố Trí ({allPlansInActiveScenario.length})
              {activeScenario ? ` - [${activeScenario.name}]` : ''}
            </span>
          </button>
        </div>

        {/* Nội dung Tab */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* ========================================================================= */}
          {/* TAB 1: KỊCH BẢN TÁC CHIẾN                                                 */}
          {/* ========================================================================= */}
          {workspaceModalTab === 'scenarios' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-2 border-b border-slate-800/60">
                <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
                  <button
                    onClick={() => setScenarioFilter('active')}
                    className={`px-3 py-1 text-xs font-semibold rounded transition-all cursor-pointer ${
                      scenarioFilter === 'active'
                        ? 'bg-cyan-950 text-cyan-300 border border-cyan-600/40 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Đang Hoạt Động ({allScenarios.filter((s) => s.status === 'draft' || s.status === 'active').length})
                  </button>
                  <button
                    onClick={() => setScenarioFilter('archived')}
                    className={`px-3 py-1 text-xs font-semibold rounded transition-all cursor-pointer ${
                      scenarioFilter === 'archived'
                        ? 'bg-slate-800 text-slate-200 border border-slate-600/40 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Lưu Trữ ({allScenarios.filter((s) => s.status === 'archived').length})
                  </button>
                  <button
                    onClick={() => setScenarioFilter('trashed')}
                    className={`px-3 py-1 text-xs font-semibold rounded transition-all cursor-pointer ${
                      scenarioFilter === 'trashed'
                        ? 'bg-rose-950/80 text-rose-300 border border-rose-600/40 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Thùng Rác ({allScenarios.filter((s) => s.status === 'trashed').length})
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  {scenarioFilter === 'trashed' &&
                    allScenarios.filter((s) => s.status === 'trashed').length > 0 && (
                      <button
                        onClick={() => handleOpenEmptyTrashDialog('scenarios')}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-rose-950/80 hover:bg-rose-900 border border-rose-600/50 text-rose-300 transition-all cursor-pointer shadow-sm"
                        title="Dọn dẹp các kịch bản đủ điều kiện trong thùng rác"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                        <span>Dọn Thùng Rác</span>
                      </button>
                    )}
                  <button
                    onClick={() => setShowCreateScenarioForm(!showCreateScenarioForm)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white shadow-[0_0_10px_rgba(6,182,212,0.3)] transition-all cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Tạo Kịch Bản Mới</span>
                  </button>
                </div>
              </div>

              {/* Form tạo Kịch bản mới */}
              {showCreateScenarioForm && (
                <form
                  onSubmit={handleCreateScenario}
                  className="p-4 rounded-xl bg-slate-900/90 border border-cyan-500/40 space-y-3 animate-in fade-in duration-150"
                >
                  <h4 className="text-xs font-bold text-cyan-300 font-mono">
                    THIẾT LẬP KỊCH BẢN TÁC CHIẾN MỚI
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2 space-y-1">
                      <label className="text-[11px] text-slate-400">Tên Kịch Bản</label>
                      <input
                        type="text"
                        value={newScenarioName}
                        onChange={(e) => setNewScenarioName(e.target.value)}
                        placeholder="Ví dụ: Bảo vệ vùng trời Bắc Bộ 2026..."
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-400"
                        autoFocus
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] text-slate-400">Phiên Bản Địa Hình</label>
                      <input
                        type="text"
                        value={newScenarioTerrain}
                        onChange={(e) => setNewScenarioTerrain(e.target.value)}
                        placeholder="v1"
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-400 font-mono"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowCreateScenarioForm(false)}
                      className="px-3 py-1.5 text-xs text-slate-400 hover:text-white rounded border border-slate-700 cursor-pointer"
                    >
                      Hủy
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1.5 text-xs font-bold rounded bg-cyan-600 hover:bg-cyan-500 text-white shadow-sm cursor-pointer"
                    >
                      Xác Nhận Tạo
                    </button>
                  </div>
                </form>
              )}

              {/* Danh sách thẻ Kịch bản */}
              <div className="space-y-2.5">
                {filteredScenarios.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 border border-dashed border-slate-800 rounded-xl">
                    <p className="text-xs font-mono">Không có kịch bản nào trong danh mục này.</p>
                  </div>
                ) : (
                  filteredScenarios.map((s) => {
                    const isActive = activeScenario?.id === s.id;
                    const scenarioPlans = Object.values(useTacticalStore.getState().plans).filter(
                      (p) => p.scenarioId === s.id
                    );
                    const isEditing = editingScenarioId === s.id;
                    const canTrash = isScenarioEligibleForTrash(s.id);

                    return (
                      <div
                        key={s.id}
                        className={`p-4 rounded-xl border transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                          isActive
                            ? 'bg-cyan-950/40 border-cyan-500/60 shadow-[0_0_15px_rgba(6,182,212,0.15)]'
                            : 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700'
                        }`}
                      >
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            {isEditing ? (
                              <div className="flex items-center gap-2 w-full max-w-sm">
                                <input
                                  type="text"
                                  value={editingScenarioName}
                                  onChange={(e) => setEditingScenarioName(e.target.value)}
                                  className="bg-slate-950 border border-cyan-500 px-2.5 py-1 text-xs text-slate-200 rounded focus:outline-none flex-1 font-semibold"
                                  autoFocus
                                />
                                <button
                                  onClick={() => handleRenameScenario(s.id)}
                                  className="p-1 rounded bg-cyan-600 text-white text-xs cursor-pointer hover:bg-cyan-500"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => setEditingScenarioId(null)}
                                  className="p-1 rounded bg-slate-800 text-slate-400 text-xs cursor-pointer hover:text-white"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <>
                                <h3 className="text-sm font-bold text-slate-100 font-mono truncate">
                                  {s.name}
                                </h3>
                                <span
                                  className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold uppercase ${
                                    s.status === 'active'
                                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                                      : s.status === 'archived'
                                      ? 'bg-slate-800 text-slate-400 border border-slate-700'
                                      : s.status === 'trashed'
                                      ? 'bg-rose-950 text-rose-300 border border-rose-600/40'
                                      : 'bg-amber-950 text-amber-300 border border-amber-500/40'
                                  }`}
                                >
                                  {SCENARIO_STATUS_LABELS[s.status] || s.status}
                                </span>
                              </>
                            )}
                          </div>
                          <div className="flex items-center gap-4 text-[11px] text-slate-400 font-mono">
                            <span>Địa hình: {s.terrainVersion}</span>
                            <span>•</span>
                            <span>{scenarioPlans.length} phương án</span>
                            <span>•</span>
                            <span>Mã: {s.id}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 flex-wrap">
                          {!isEditing && s.status !== 'archived' && s.status !== 'trashed' && (
                            <button
                              onClick={() => {
                                setEditingScenarioId(s.id);
                                setEditingScenarioName(s.name);
                              }}
                              className="p-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors cursor-pointer"
                              title="Đổi tên kịch bản"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {/* Archive / Restore actions */}
                          {s.status !== 'archived' && s.status !== 'trashed' && (
                            <button
                              onClick={() =>
                                setConfirmDialog({
                                  type: 'archive_scenario',
                                  targetId: s.id,
                                  targetName: s.name,
                                })
                              }
                              className="p-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-amber-300 hover:border-amber-500/50 transition-colors cursor-pointer"
                              title="Lưu trữ kịch bản"
                            >
                              <Archive className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {s.status === 'archived' && (
                            <button
                              onClick={() => {
                                try {
                                  restoreScenario(s.id);
                                  showToast('success', `Đã khôi phục kịch bản: "${s.name}".`);
                                } catch (err: any) {
                                  showToast('error', err?.message || 'Lỗi khi khôi phục.');
                                }
                              }}
                              className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded bg-cyan-950 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-900 transition-colors cursor-pointer"
                              title="Khôi phục kịch bản từ lưu trữ"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>Khôi Phục</span>
                            </button>
                          )}

                          {/* Trash / Restore actions */}
                          {s.status === 'draft' && (
                            <button
                              onClick={() => {
                                if (!canTrash) {
                                  showToast(
                                    'error',
                                    'Không thể đưa kịch bản vào thùng rác do có phương án đã đề xuất/phê duyệt hoặc có kết quả mô phỏng. Hãy chọn Lưu Trữ.'
                                  );
                                  return;
                                }
                                setConfirmDialog({
                                  type: 'trash_scenario',
                                  targetId: s.id,
                                  targetName: s.name,
                                });
                              }}
                              disabled={!canTrash}
                              className="p-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-rose-400 hover:border-rose-500/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
                              title={
                                canTrash
                                  ? 'Chuyển kịch bản vào thùng rác'
                                  : 'Không thể xóa kịch bản có phương án đề xuất/phê duyệt'
                              }
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {s.status === 'trashed' && (() => {
                            const eligibility = isScenarioEligibleForPurge(useTacticalStore.getState(), s.id);
                            return (
                              <div className="flex items-center gap-1.5">
                                <button
                                  onClick={() => {
                                    try {
                                      restoreDraftScenario(s.id);
                                      showToast('success', `Đã khôi phục kịch bản: "${s.name}".`);
                                    } catch (err: any) {
                                      showToast('error', err?.message || 'Lỗi khi khôi phục.');
                                    }
                                  }}
                                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded bg-emerald-950 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-900 transition-colors cursor-pointer"
                                  title="Khôi phục kịch bản từ thùng rác"
                                >
                                  <Undo2 className="w-3.5 h-3.5" />
                                  <span>Khôi Phục</span>
                                </button>
                                {eligibility.eligible ? (
                                  <button
                                    onClick={() =>
                                      setConfirmDialog({
                                        type: 'purge_scenario',
                                        targetId: s.id,
                                        targetName: s.name,
                                      })
                                    }
                                    className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded bg-rose-950 text-rose-300 border border-rose-600/40 hover:bg-rose-900 transition-colors cursor-pointer"
                                    title="Xóa vĩnh viễn kịch bản để giải phóng dung lượng"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    <span>Xóa Vĩnh Viễn</span>
                                  </button>
                                ) : (
                                  <span
                                    className="text-[10px] px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-700 italic cursor-help"
                                    title={`Không thể xóa vĩnh viễn: ${eligibility.reason}. Đề xuất: Lưu trữ.`}
                                  >
                                    Bảo vệ lịch sử
                                  </span>
                                )}
                              </div>
                            );
                          })()}

                          {/* Switch Active Scenario */}
                          {s.status !== 'trashed' && (
                            isActive ? (
                              <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-950/80 text-emerald-300 border border-emerald-500/50">
                                <Check className="w-3.5 h-3.5" />
                                <span>ĐANG CHỌN</span>
                              </div>
                            ) : (
                              <button
                                onClick={() => {
                                  try {
                                    switchScenario(s.id);
                                    showToast('success', `Đã kích hoạt kịch bản: "${s.name}".`);
                                  } catch (err: any) {
                                    showToast('error', err?.message || 'Lỗi khi kích hoạt kịch bản.');
                                  }
                                }}
                                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-800 hover:bg-cyan-900/60 hover:text-cyan-300 border border-slate-700 hover:border-cyan-500/40 text-slate-300 transition-all cursor-pointer"
                              >
                                Kích Hoạt
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 2: PHƯƠNG ÁN BỐ TRÍ                                                    */}
          {/* ========================================================================= */}
          {workspaceModalTab === 'plans' && (
            <div className="space-y-4">
              {/* Context bar */}
              <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Globe2 className="w-4 h-4 text-cyan-400" />
                  <span className="text-xs text-slate-300">
                    Kịch bản ngữ cảnh:{' '}
                    <strong className="text-cyan-300 font-mono">
                      {activeScenario ? activeScenario.name : 'Chưa chọn'}
                    </strong>
                  </span>
                  {activeScenario && (
                    <span
                      className={`text-[9px] px-1.5 py-0.2 rounded font-mono font-bold uppercase ${
                        activeScenario.status === 'archived'
                          ? 'bg-slate-800 text-slate-400 border border-slate-700'
                          : activeScenario.status === 'trashed'
                          ? 'bg-rose-950 text-rose-300 border border-rose-600/40'
                          : 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                      }`}
                    >
                      {SCENARIO_STATUS_LABELS[activeScenario.status] || activeScenario.status}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={handleValidatePlan}
                    className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded bg-slate-800 hover:bg-cyan-950 border border-slate-700 hover:border-cyan-500/50 text-cyan-300 transition-all cursor-pointer"
                    title="Xác thực đồ thị khí tài và liên kết chỉ huy của phương án hiện hành"
                  >
                    <Shield className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Kiểm Tra Hợp Lệ</span>
                  </button>
                  <button
                    onClick={() => setShowCreatePlanForm(!showCreatePlanForm)}
                    disabled={activeScenario?.status === 'archived' || activeScenario?.status === 'trashed'}
                    className="flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed text-white shadow-sm transition-all cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Phương Án Mới</span>
                  </button>
                  <button
                    onClick={() => handleClonePlan()}
                    disabled={activeScenario?.status === 'archived' || activeScenario?.status === 'trashed' || !activePlan}
                    className="flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white shadow-sm transition-all cursor-pointer"
                    title="Tạo phương án thay thế mới từ phương án đang chọn"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Tạo Phương Án Thay Thế</span>
                  </button>
                </div>
              </div>

              {/* Sub-filter tabs for Plans */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800 w-fit">
                  <button
                    onClick={() => setPlanFilter('active')}
                    className={`px-3 py-1 text-xs font-semibold rounded transition-all cursor-pointer ${
                      planFilter === 'active'
                        ? 'bg-cyan-950 text-cyan-300 border border-cyan-600/40 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Hiện Hành ({allPlansInActiveScenario.filter((p) => p.status === 'draft' || p.status === 'proposed' || p.status === 'approved').length})
                  </button>
                  <button
                    onClick={() => setPlanFilter('history')}
                    className={`px-3 py-1 text-xs font-semibold rounded transition-all cursor-pointer ${
                      planFilter === 'history'
                        ? 'bg-slate-800 text-slate-200 border border-slate-600/40 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Đã Thu Hồi ({allPlansInActiveScenario.filter((p) => p.status === 'withdrawn').length})
                  </button>
                  <button
                    onClick={() => setPlanFilter('archived')}
                    className={`px-3 py-1 text-xs font-semibold rounded transition-all cursor-pointer ${
                      planFilter === 'archived'
                        ? 'bg-amber-950/80 text-amber-300 border border-amber-600/40 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Lưu Trữ ({allPlansInActiveScenario.filter((p) => p.status === 'archived').length})
                  </button>
                  <button
                    onClick={() => setPlanFilter('trashed')}
                    className={`px-3 py-1 text-xs font-semibold rounded transition-all cursor-pointer ${
                      planFilter === 'trashed'
                        ? 'bg-rose-950/80 text-rose-300 border border-rose-600/40 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Thùng Rác ({allPlansInActiveScenario.filter((p) => p.status === 'trashed').length})
                  </button>
                </div>

                {planFilter === 'trashed' &&
                  allPlansInActiveScenario.filter((p) => p.status === 'trashed').length > 0 && (
                    <button
                      onClick={() => handleOpenEmptyTrashDialog('plans')}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-rose-950/80 hover:bg-rose-900 border border-rose-600/50 text-rose-300 transition-all cursor-pointer shadow-sm"
                      title="Dọn dẹp các phương án đủ điều kiện trong thùng rác"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                      <span>Dọn Thùng Rác</span>
                    </button>
                  )}
              </div>

              {/* Form tạo phương án mới */}
              {showCreatePlanForm && (
                <form
                  onSubmit={handleCreateEmptyPlan}
                  className="p-4 rounded-xl bg-slate-900/90 border border-cyan-500/40 space-y-3 animate-in fade-in duration-150"
                >
                  <h4 className="text-xs font-bold text-cyan-300 font-mono">
                    TẠO PHƯƠNG ÁN BỐ TRÍ MỚI
                  </h4>
                  <div className="space-y-1">
                    <label className="text-[11px] text-slate-400">Tên Phương Án</label>
                    <input
                      type="text"
                      value={newPlanName}
                      onChange={(e) => setNewPlanName(e.target.value)}
                      placeholder="Ví dụ: Phương án tác chiến bảo vệ phía Tây..."
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-400"
                      autoFocus
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowCreatePlanForm(false)}
                      className="px-3 py-1.5 text-xs text-slate-400 hover:text-white rounded border border-slate-700 cursor-pointer"
                    >
                      Hủy
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1.5 text-xs font-bold rounded bg-cyan-600 hover:bg-cyan-500 text-white shadow-sm cursor-pointer"
                    >
                      Xác Nhận Tạo
                    </button>
                  </div>
                </form>
              )}

              {/* Danh sách thẻ Phương án */}
              <div className="space-y-2.5">
                {filteredPlans.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 border border-dashed border-slate-800 rounded-xl">
                    <p className="text-xs font-mono">
                      Không có phương án nào trong mục này.
                    </p>
                  </div>
                ) : (
                  filteredPlans.map((p) => {
                    const isActive = activePlan?.id === p.id;
                    const planPlacements = Object.values(placements).filter(
                      (pl) => pl.planId === p.id
                    );
                    const isEditing = editingPlanId === p.id;

                    return (
                      <div
                        key={p.id}
                        className={`p-4 rounded-xl border transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                          isActive
                            ? 'bg-cyan-950/40 border-cyan-500/60 shadow-[0_0_15px_rgba(6,182,212,0.15)]'
                            : 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700'
                        }`}
                      >
                        <div className="space-y-1.5 min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            {isEditing ? (
                              <div className="flex items-center gap-2 w-full max-w-sm">
                                <input
                                  type="text"
                                  value={editingPlanName}
                                  onChange={(e) => setEditingPlanName(e.target.value)}
                                  className="bg-slate-950 border border-cyan-500 px-2.5 py-1 text-xs text-slate-200 rounded focus:outline-none flex-1 font-semibold"
                                  autoFocus
                                />
                                <button
                                  onClick={() => handleRenamePlan(p.id)}
                                  className="p-1 rounded bg-cyan-600 text-white text-xs cursor-pointer hover:bg-cyan-500"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => setEditingPlanId(null)}
                                  className="p-1 rounded bg-slate-800 text-slate-400 text-xs cursor-pointer hover:text-white"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <>
                                <h3 className="text-sm font-bold text-slate-100 font-mono truncate">
                                  {p.name}
                                </h3>

                                {/* Badges: Phiên bản & Bản sửa đổi */}
                                <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-bold bg-slate-800 text-cyan-300 border border-cyan-500/30">
                                  v{p.version}
                                </span>
                                {p.revisionNumber && p.revisionNumber > 1 && (
                                  <span
                                    className="text-[10px] px-1.5 py-0.5 rounded font-mono font-bold bg-violet-950 text-violet-300 border border-violet-500/40"
                                    title={`Bản sửa đổi ${p.revisionNumber}`}
                                  >
                                    r{p.revisionNumber}
                                  </span>
                                )}
                                <span
                                  className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold uppercase flex items-center gap-1 ${
                                    p.status === 'approved'
                                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                                      : p.status === 'proposed'
                                      ? 'bg-sky-950 text-sky-300 border border-sky-500/40'
                                      : p.status === 'withdrawn'
                                      ? 'bg-slate-800 text-slate-400 border border-slate-600'
                                      : p.status === 'archived'
                                      ? 'bg-amber-950/80 text-amber-300 border border-amber-600/40'
                                      : p.status === 'trashed'
                                      ? 'bg-rose-950 text-rose-300 border border-rose-600/40'
                                      : 'bg-amber-950 text-amber-300 border border-amber-500/40'
                                  }`}
                                >
                                  {p.status === 'draft' ? (
                                    <Edit3 className="w-2.5 h-2.5 text-amber-400" />
                                  ) : p.status === 'proposed' ? (
                                    <Clock className="w-2.5 h-2.5 text-sky-400" />
                                  ) : p.status === 'withdrawn' ? (
                                    <History className="w-2.5 h-2.5 text-slate-400" />
                                  ) : p.status === 'archived' ? (
                                    <Archive className="w-2.5 h-2.5 text-amber-400" />
                                  ) : (
                                    <Shield className="w-2.5 h-2.5 text-emerald-400" />
                                  )}
                                  <span>{PLAN_STATUS_LABELS[p.status] || p.status}</span>
                                </span>
                              </>
                            )}
                          </div>

                          <div className="flex items-center gap-4 text-[11px] text-slate-400 font-mono flex-wrap">
                            <span>{planPlacements.length} khí tài bố trí</span>
                            <span>•</span>
                            <span>Mã: {p.id}</span>
                            {p.baseRevisionPlanId && (
                              <>
                                <span>•</span>
                                <span className="text-violet-300">Từ Bản sửa đổi: {p.baseRevisionPlanId}</span>
                              </>
                            )}
                            {p.withdrawnReason && (
                              <>
                                <span>•</span>
                                <span className="text-amber-300 italic truncate max-w-xs">
                                  Lý do thu hồi: &quot;{p.withdrawnReason}&quot;
                                </span>
                              </>
                            )}
                            {p.status !== 'draft' && (
                              <span className="text-amber-400/90 font-sans flex items-center gap-1">
                                <Lock className="w-3 h-3" /> Chỉ xem
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 flex-wrap">
                          {/* Rename (draft only, not archived/trashed) */}
                          {!isEditing &&
                            p.status === 'draft' &&
                            activeScenario?.status !== 'archived' &&
                            activeScenario?.status !== 'trashed' && (
                              <button
                                onClick={() => {
                                  setEditingPlanId(p.id);
                                  setEditingPlanName(p.name);
                                }}
                                className="p-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors cursor-pointer"
                                title="Đổi tên phương án"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                            )}

                          {/* Submit / Propose (draft only) */}
                          {p.status === 'draft' &&
                            activeScenario?.status !== 'archived' &&
                            activeScenario?.status !== 'trashed' && (
                              <button
                                onClick={() =>
                                  setConfirmDialog({
                                    type: 'propose_plan',
                                    targetId: p.id,
                                    targetName: p.name,
                                    equipmentCount: planPlacements.length,
                                  })
                                }
                                className="px-2.5 py-1 text-xs font-semibold rounded bg-sky-950/80 hover:bg-sky-900 text-sky-300 border border-sky-500/40 transition-colors cursor-pointer"
                                title="Đề xuất xét duyệt phương án (đóng băng chỉnh sửa)"
                              >
                                Đề Xuất
                              </button>
                            )}

                          {/* Thu hồi để sửa (proposed only) */}
                          {p.status === 'proposed' &&
                            activeScenario?.status !== 'archived' &&
                            activeScenario?.status !== 'trashed' && (
                              <button
                                onClick={() => {
                                  setWithdrawReasonInput('');
                                  setConfirmDialog({
                                    type: 'withdraw_plan',
                                    targetId: p.id,
                                    targetName: p.name,
                                  });
                                }}
                                className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded bg-amber-950/80 hover:bg-amber-900 text-amber-300 border border-amber-500/40 transition-colors cursor-pointer"
                                title="Thu hồi phương án đã đề xuất để bổ sung khí tài và tạo bản sửa đổi mới"
                              >
                                <History className="w-3.5 h-3.5" />
                                <span>Thu Hồi Để Sửa</span>
                              </button>
                            )}

                          {/* Tạo phương án thay thế */}
                          <button
                            onClick={() => handleClonePlan(p.id)}
                            disabled={activeScenario?.status === 'archived' || activeScenario?.status === 'trashed' || p.status === 'trashed'}
                            className="p-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-cyan-300 hover:border-cyan-500/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
                            title={p.status === 'trashed' ? 'Không thể nhân bản phương án trong thùng rác' : 'Tạo phương án thay thế mới từ phương án này'}
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>

                          {/* Archive Plan */}
                          {p.status !== 'archived' &&
                            p.status !== 'trashed' &&
                            p.status !== 'withdrawn' &&
                            activeScenario?.status !== 'archived' &&
                            activeScenario?.status !== 'trashed' && (
                              <button
                                onClick={() =>
                                  setConfirmDialog({
                                    type: 'archive_plan',
                                    targetId: p.id,
                                    targetName: p.name,
                                  })
                                }
                                className="p-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-amber-300 hover:border-amber-500/50 transition-colors cursor-pointer"
                                title="Lưu trữ phương án"
                              >
                                <Archive className="w-3.5 h-3.5" />
                              </button>
                            )}

                          {/* Restore Archived Plan */}
                          {p.status === 'archived' &&
                            activeScenario?.status !== 'archived' &&
                            activeScenario?.status !== 'trashed' && (
                              <button
                                onClick={() => {
                                  try {
                                    restorePlan(p.id);
                                    showToast('success', `Đã khôi phục phương án: "${p.name}".`);
                                  } catch (err: any) {
                                    showToast('error', err?.message || 'Lỗi khi khôi phục.');
                                  }
                                }}
                                className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded bg-cyan-950 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-900 transition-colors cursor-pointer"
                                title="Khôi phục phương án từ lưu trữ"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                <span>Khôi Phục</span>
                              </button>
                            )}

                          {/* Trash Draft Plan */}
                          {p.status === 'draft' &&
                            activeScenario?.status !== 'archived' &&
                            activeScenario?.status !== 'trashed' && (
                              <button
                                onClick={() =>
                                  setConfirmDialog({
                                    type: 'trash_plan',
                                    targetId: p.id,
                                    targetName: p.name,
                                  })
                                }
                                className="p-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-rose-400 hover:border-rose-500/50 transition-colors cursor-pointer"
                                title="Chuyển phương án vào thùng rác"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}

                          {/* Restore / Purge Trashed Plan */}
                          {p.status === 'trashed' &&
                            activeScenario?.status !== 'archived' &&
                            activeScenario?.status !== 'trashed' && (() => {
                              const eligibility = isPlanEligibleForPurge(useTacticalStore.getState(), p.id);
                              return (
                                <div className="flex items-center gap-1.5">
                                  <button
                                    onClick={() => {
                                      try {
                                        restoreDraftPlan(p.id);
                                        showToast('success', `Đã khôi phục phương án: "${p.name}".`);
                                      } catch (err: any) {
                                        showToast('error', err?.message || 'Lỗi khi khôi phục.');
                                      }
                                    }}
                                    className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded bg-emerald-950 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-900 transition-colors cursor-pointer"
                                    title="Khôi phục phương án từ thùng rác"
                                  >
                                    <Undo2 className="w-3.5 h-3.5" />
                                    <span>Khôi Phục</span>
                                  </button>
                                  {eligibility.eligible ? (
                                    <button
                                      onClick={() =>
                                        setConfirmDialog({
                                          type: 'purge_plan',
                                          targetId: p.id,
                                          targetName: p.name,
                                        })
                                      }
                                      className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded bg-rose-950 text-rose-300 border border-rose-600/40 hover:bg-rose-900 transition-colors cursor-pointer"
                                      title="Xóa vĩnh viễn phương án để giải phóng dung lượng"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                      <span>Xóa Vĩnh Viễn</span>
                                    </button>
                                  ) : (
                                    <span
                                      className="text-[10px] px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-700 italic cursor-help"
                                      title={`Không thể xóa vĩnh viễn: ${eligibility.reason}. Đề xuất: Lưu trữ.`}
                                    >
                                      Bảo vệ lịch sử
                                    </span>
                                  )}
                                </div>
                              );
                            })()}

                          {/* Switch Active Plan (Chỉ hiển thị cho phương án hiện hành, chặn tuyệt đối bản withdrawn, archived, trashed) */}
                          {p.status !== 'trashed' && p.status !== 'withdrawn' && p.status !== 'archived' && (
                            isActive ? (
                              <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-950/80 text-emerald-300 border border-emerald-500/50">
                                <Check className="w-3.5 h-3.5" />
                                <span>ĐANG CHỌN</span>
                              </div>
                            ) : (
                              <button
                                onClick={() => {
                                  try {
                                    switchActivePlan(p.id);
                                    showToast('success', `Đã chuyển sang phương án: "${p.name}".`);
                                  } catch (err: any) {
                                    showToast('error', err?.message || 'Lỗi khi chuyển phương án.');
                                  }
                                }}
                                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-800 hover:bg-cyan-900/60 hover:text-cyan-300 border border-slate-700 hover:border-cyan-500/40 text-slate-300 transition-all cursor-pointer"
                              >
                                Kích Hoạt
                              </button>
                            )
                          )}

                          {/* Withdrawn Historical Marker & Xem chi tiết read-only */}
                          {p.status === 'withdrawn' && (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() =>
                                  setExpandedWithdrawnPlanId(expandedWithdrawnPlanId === p.id ? null : p.id)
                                }
                                className="px-2 py-1 text-[11px] font-semibold rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 transition-all cursor-pointer"
                                title="Xem danh sách khí tài trong bản ghi lịch sử này"
                              >
                                {expandedWithdrawnPlanId === p.id ? 'Ẩn Khí Tài' : 'Xem Khí Tài'}
                              </button>
                              <div className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded bg-slate-900 border border-slate-800 text-slate-400">
                                <Lock className="w-3 h-3 text-slate-500" />
                                <span>LỊCH SỬ</span>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Read-only equipment drawer for withdrawn plan */}
                        {expandedWithdrawnPlanId === p.id && p.status === 'withdrawn' && (
                          <div className="mt-3 pt-3 border-t border-slate-800/80 w-full space-y-2 animate-in fade-in duration-150">
                            <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                              <span>BẢN GHI LỊCH SỬ KHÍ TÀI ({planPlacements.length} khí tài đóng băng)</span>
                              <span className="text-amber-400/90 italic">Chỉ xem — Không thể kích hoạt làm phương án hiện hành</span>
                            </div>
                            {planPlacements.length === 0 ? (
                              <div className="text-[11px] text-slate-500 italic p-2 bg-slate-950/60 rounded border border-slate-900">
                                Không có khí tài nào trong bản ghi này.
                              </div>
                            ) : (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {planPlacements.map((pl) => {
                                  const def = definitions[pl.definitionId];
                                  return (
                                    <div
                                      key={pl.id}
                                      className="p-2 rounded bg-slate-950/70 border border-slate-800/80 text-[11px] flex items-center justify-between font-mono"
                                    >
                                      <div>
                                        <span className="font-bold text-slate-200">{def?.name || pl.id}</span>
                                        <span className="text-[10px] text-cyan-400 ml-1.5">[{def?.category || 'Khí tài'}]</span>
                                      </div>
                                      <div className="text-[10px] text-slate-400">
                                        {pl.position.lat.toFixed(4)}, {pl.position.lon.toFixed(4)}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* ========================================================================= */}
        {/* CONFIRMATION / REASON DIALOG MODAL                                        */}
        {/* ========================================================================= */}
        {confirmDialog && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
            <div className="w-full max-w-lg bg-slate-900 border border-cyan-700/60 rounded-xl p-5 shadow-2xl space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-400" />
                  <h3 className="text-sm font-bold text-slate-100 font-mono">
                    {confirmDialog.type === 'propose_plan' && 'XÁC NHẬN ĐỀ XUẤT PHƯƠNG ÁN'}
                    {confirmDialog.type === 'withdraw_plan' && 'THU HỒI ĐỀ XUẤT ĐỂ SỬA ĐỔI'}
                    {confirmDialog.type === 'trash_plan' && 'CHUYỂN PHƯƠNG ÁN VÀO THÙNG RÁC'}
                    {confirmDialog.type === 'archive_plan' && 'LƯU TRỮ PHƯƠNG ÁN'}
                    {confirmDialog.type === 'archive_scenario' && 'LƯU TRỮ KỊCH BẢN'}
                    {confirmDialog.type === 'trash_scenario' && 'CHUYỂN KỊCH BẢN VÀO THÙNG RÁC'}
                    {confirmDialog.type === 'purge_plan' && 'XÁC NHẬN XÓA VĨNH VIỄN PHƯƠNG ÁN'}
                    {confirmDialog.type === 'purge_scenario' && 'XÁC NHẬN XÓA VĨNH VIỄN KỊCH BẢN'}
                    {confirmDialog.type === 'empty_trash' && 'DỌN THÙNG RÁC'}
                  </h3>
                </div>
                <button
                  onClick={() => setConfirmDialog(null)}
                  className="text-slate-400 hover:text-white p-1 rounded"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {confirmDialog.type === 'propose_plan' && (
                <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
                  <p>
                    Bạn đang chuẩn bị gửi xét duyệt phương án:{' '}
                    <strong className="text-cyan-300 font-mono">{confirmDialog.targetName}</strong>.
                  </p>
                  <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800 space-y-1 font-mono text-[11px]">
                    <div>Số lượng khí tài bố trí: <strong className="text-amber-300">{confirmDialog.equipmentCount}</strong> đơn vị</div>
                    <div>Ngữ cảnh: {activeScenario?.name}</div>
                  </div>
                  <p className="text-amber-300/90">
                    Lưu ý: Sau khi đề xuất, phương án này sẽ được <strong>đóng băng chỉ xem</strong>. Nếu phát hiện thiếu sót khí tài sau khi gửi, bạn cần thực hiện &quot;Thu hồi để sửa&quot; để tạo một bản sửa đổi mới.
                  </p>
                </div>
              )}

              {confirmDialog.type === 'withdraw_plan' && (
                <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
                  <p>
                    Thu hồi phương án đã đề xuất:{' '}
                    <strong className="text-cyan-300 font-mono">{confirmDialog.targetName}</strong>.
                  </p>
                  <p className="text-slate-400">
                    Bản đề xuất cũ sẽ được đánh dấu <strong>ĐÃ THU HỒI</strong> và lưu trữ bất biến. Hệ thống sẽ tự động tạo một <strong>Bản Dự Thảo Mới (Bản sửa đổi mới của cùng phương án)</strong> để bạn bổ sung khí tài và gửi xét duyệt lại.
                  </p>
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-slate-300">
                      Lý do thu hồi (Bắt buộc):
                    </label>
                    <textarea
                      rows={3}
                      value={withdrawReasonInput}
                      onChange={(e) => setWithdrawReasonInput(e.target.value)}
                      placeholder="Ví dụ: Bổ sung trận địa tên lửa S-300 bị thiếu sau nghiệm thu thực tế..."
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-400"
                      autoFocus
                    />
                  </div>
                </div>
              )}

              {confirmDialog.type === 'trash_plan' && (
                <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
                  <p>
                    Bạn có chắc chắn muốn chuyển phương án{' '}
                    <strong className="text-rose-300 font-mono">{confirmDialog.targetName}</strong> vào thùng rác?
                  </p>
                  <p className="text-slate-400">
                    Đây là thao tác xóa mềm (Soft delete). Bản ghi vẫn được lưu trữ và có thể khôi phục lại bất kỳ lúc nào từ tab Thùng Rác.
                  </p>
                </div>
              )}

              {confirmDialog.type === 'archive_plan' && (
                <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
                  <p>
                    Bạn có chắc chắn muốn lưu trữ phương án{' '}
                    <strong className="text-amber-300 font-mono">{confirmDialog.targetName}</strong>?
                  </p>
                  <p className="text-slate-400">
                    Phương án sẽ chuyển sang trạng thái <strong>Lưu Trữ (Chỉ Xem)</strong>. Mọi bố trí khí tài, snapshot và lịch sử được bảo toàn nguyên vẹn. Bạn có thể khôi phục lại bất kỳ lúc nào từ tab Lưu Trữ.
                  </p>
                </div>
              )}

              {confirmDialog.type === 'archive_scenario' && (
                <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
                  <p>
                    Bạn có chắc chắn muốn lưu trữ kịch bản{' '}
                    <strong className="text-amber-300 font-mono">{confirmDialog.targetName}</strong>?
                  </p>
                  <p className="text-slate-400">
                    Kịch bản và toàn bộ các phương án bên trong sẽ chuyển sang trạng thái <strong>Chỉ Xem</strong>. Bạn có thể khôi phục lại kịch bản bất cứ lúc nào từ tab Lưu Trữ.
                  </p>
                </div>
              )}

              {confirmDialog.type === 'trash_scenario' && (
                <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
                  <p>
                    Bạn có chắc chắn muốn chuyển kịch bản{' '}
                    <strong className="text-rose-300 font-mono">{confirmDialog.targetName}</strong> vào thùng rác?
                  </p>
                  <p className="text-slate-400">
                    Kịch bản này sẽ được chuyển vào thùng rác (xóa mềm). Bản ghi vẫn được lưu trữ và có thể khôi phục lại bất cứ lúc nào từ tab Thùng Rác.
                  </p>
                </div>
              )}

              {confirmDialog.type === 'purge_plan' && (
                <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
                  <p>
                    Bạn có chắc chắn muốn xóa vĩnh viễn phương án{' '}
                    <strong className="text-rose-400 font-mono">{confirmDialog.targetName}</strong>?
                  </p>
                  <p className="text-rose-300/90 font-medium">
                    CẢNH BÁO: Thao tác này KHÔNG THỂ HOÀN TÁC. Phương án cùng toàn bộ cấu hình khí tài bên trong sẽ bị loại bỏ hoàn toàn để giải phóng dung lượng. (Dấu vết kiểm toán lịch sử tối thiểu được lưu giữ để đảm bảo tính toàn vẹn hệ thống).
                  </p>
                </div>
              )}

              {confirmDialog.type === 'purge_scenario' && (
                <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
                  <p>
                    Bạn có chắc chắn muốn xóa vĩnh viễn kịch bản{' '}
                    <strong className="text-rose-400 font-mono">{confirmDialog.targetName}</strong>?
                  </p>
                  <p className="text-rose-300/90 font-medium">
                    CẢNH BÁO: Thao tác này KHÔNG THỂ HOÀN TÁC. Kịch bản cùng toàn bộ các phương án nháp và cấu hình khí tài bên trong sẽ bị loại bỏ hoàn toàn để giải phóng dung lượng. (Dấu vết kiểm toán lịch sử tối thiểu được lưu giữ để đảm bảo tính toàn vẹn hệ thống).
                  </p>
                </div>
              )}

              {confirmDialog.type === 'empty_trash' && (
                <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
                  <p className="font-semibold text-slate-200">
                    Xác nhận dọn dẹp các mục trong Thùng rác:
                  </p>
                  {confirmDialog.summary && (
                    <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800 space-y-2 font-mono text-[11px]">
                      <div className="text-emerald-400 font-semibold">
                        Số mục đủ điều kiện xóa vĩnh viễn:{' '}
                        <strong>{confirmDialog.summary.eligiblePlans.length}</strong> phương án,{' '}
                        <strong>{confirmDialog.summary.eligibleScenarios.length}</strong> kịch bản
                      </div>
                      {(confirmDialog.summary.retainedPlans.length > 0 ||
                        confirmDialog.summary.retainedScenarios.length > 0) && (
                        <div className="text-amber-300/90 space-y-1 pt-1 border-t border-slate-800/80">
                          <div>
                            Mục được giữ lại (bảo vệ lịch sử / liên kết mô phỏng):{' '}
                            <strong>
                              {confirmDialog.summary.retainedPlans.length +
                                confirmDialog.summary.retainedScenarios.length}
                            </strong>
                          </div>
                          {confirmDialog.summary.retainedPlans.map((r) => (
                            <div key={r.plan.id} className="text-[10px] text-slate-400">
                              • Phương án [{r.plan.name}]: {r.reason}
                            </div>
                          ))}
                          {confirmDialog.summary.retainedScenarios.map((r) => (
                            <div key={r.scenario.id} className="text-[10px] text-slate-400">
                              • Kịch bản [{r.scenario.name}]: {r.reason}
                            </div>
                          ))}
                          <div className="text-[10px] text-amber-400 italic">
                            Đề xuất: Sử dụng tính năng Lưu Trữ cho các mục được bảo vệ.
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  <p className="text-rose-300/90 font-medium">
                    Lưu ý: Các mục đủ điều kiện sẽ bị xóa vĩnh viễn và không thể khôi phục.
                  </p>
                </div>
              )}

              {confirmDialog.type === 'import_workspace' && (
                <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
                  <p>
                    Bạn có chắc chắn muốn nạp gói không gian làm việc từ tệp{' '}
                    <strong className="text-cyan-300 font-mono">{confirmDialog.targetName}</strong>?
                  </p>
                  {confirmDialog.contextInfo && (
                    <div className="p-2.5 rounded-lg bg-slate-900 border border-cyan-800/40 text-cyan-200 font-mono text-[11px]">
                      {confirmDialog.contextInfo}
                    </div>
                  )}
                  <p className="text-amber-300/90 font-medium">
                    CẢNH BÁO: Thao tác này sẽ thay thế toàn bộ trạng thái hiện tại của Workspace (tất cả kịch bản, phương án, bố trí khí tài và lịch sử). Nếu bạn nhấn &quot;Hủy Bỏ&quot;, dữ liệu hiện tại trong hệ thống sẽ được giữ nguyên 100%.
                  </p>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setConfirmDialog(null)}
                  className="px-3.5 py-1.5 text-xs text-slate-400 hover:text-white rounded border border-slate-700 cursor-pointer"
                >
                  Hủy Bỏ
                </button>
                <button
                  type="button"
                  onClick={handleExecuteConfirmedAction}
                  disabled={confirmDialog.type === 'withdraw_plan' && !withdrawReasonInput.trim()}
                  className={`px-4 py-1.5 text-xs font-bold rounded text-white shadow-sm transition-all cursor-pointer ${
                    confirmDialog.type === 'trash_plan' ||
                    confirmDialog.type === 'trash_scenario' ||
                    confirmDialog.type === 'purge_plan' ||
                    confirmDialog.type === 'purge_scenario' ||
                    confirmDialog.type === 'empty_trash'
                      ? 'bg-rose-600 hover:bg-rose-500'
                      : confirmDialog.type === 'withdraw_plan' || confirmDialog.type === 'import_workspace'
                      ? 'bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed'
                      : 'bg-cyan-600 hover:bg-cyan-500'
                  }`}
                >
                  {confirmDialog.type === 'purge_plan' ||
                  confirmDialog.type === 'purge_scenario' ||
                  confirmDialog.type === 'empty_trash'
                    ? 'Xác Nhận Xóa Vĩnh Viễn'
                    : 'Xác Nhận Thực Hiện'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
