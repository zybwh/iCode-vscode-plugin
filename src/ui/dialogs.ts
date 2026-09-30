// Dialog, picker and report surfaces, grouped by area under ./dialogs/.
// This barrel keeps the `./ui/dialogs` import path stable.
export { setTrackedInlineDialogState, showInlineNotice, inlineDialogError, showJsonDocument, languageFromPath } from "./dialogs/common";
export { refreshOpenSessionsDialog, openSessionsDialog, resumeLastSession, loadSavedSession, openAgentsDialog, refreshSessionsSidebar, handleSessionsSidebarRequest } from "./dialogs/sessions";
export { openRuntimeDialog, openLogsDialog, clearLogsRefreshTimer, handleInlineDialogAction } from "./dialogs/runtimeDialog";
export { showSessionDiff, rollbackSession, retryPausedSubAgent, abortPausedSubAgent, selectPausedSubAgent, setApprovalMode } from "./dialogs/sessionControls";
export { switchActiveAgent, showAgentProfiles, showModelProfiles, showStructuredHistory, setModelProfile, openModelDialog, refreshModelDialog, saveModelFromDialog, deleteModelFromDialog, setActiveModelFromDialog, modelDialogError, openAgentDialog, refreshAgentDialog, saveAgentFromDialog, deleteAgentFromDialog, setActiveAgentFromDialog, createModelProfile, deleteModelProfile, deleteAgentProfile, testMcpServer, setConfigOption } from "./dialogs/profiles";
export { reloadChrysSettings, changeWorkspace, expandWorkspacePath, managementTabFromArg } from "./dialogs/settings";
export { showRuntimeDetails, showDiagnosticsReport, copySupportBundle, runDoctor } from "./dialogs/diagnostics";
export { attachFileToComposer, insertFileMention, searchWorkspace, grepWorkspace, findWorkspaceFile, pickWorkspaceFile, openEditorFileItems, openWorkspaceShell, openToolDiff, openWorkspaceFile, requirePathJoin } from "./dialogs/workspace";
export { pickLanguageFromList, pickThemeFromList } from "./dialogs/preferences";
