import { ensureDevtoolsHook } from '../src/fiber';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// react-dom looks for the hook once, when its module is evaluated. Create it first.
ensureDevtoolsHook();
