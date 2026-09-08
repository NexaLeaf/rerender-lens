/**
 * Entry for the IIFE bundle the Chrome extension injects into a page (`RerenderLens` global).
 * Same API as the package minus `useWhyRerender`, which needs `react` as a module.
 */
export type {
  Change,
  ChangeKind,
  ComponentMatcher,
  HookChange,
  Notifier,
  Options,
  ParentInfo,
  RenderReport,
  RenderTrigger,
  SourceLocation,
} from './types';
export { MARKER } from './types';
export { init, configure, disable, isEnabled, track, getDisplayName, shouldTrack } from './tracker';
export { ensureDevtoolsHook, getRenderers, isProductionReact } from './fiber';
export { deepEqual, diffRecords, classify } from './diff';
export { buildReport, summarize, printReport } from './report';
export { createCollector, combineNotifiers } from './notifiers';
export { createDevtoolsNotifier, serialize, DEVTOOLS_MARKER, PROTOCOL_VERSION } from './devtools';
export { VERSION } from './version';
