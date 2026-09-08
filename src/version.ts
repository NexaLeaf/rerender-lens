declare const __RERENDER_LENS_VERSION__: string | undefined;

/** Library version, injected by the build; "dev" when running from source. */
export const VERSION: string = typeof __RERENDER_LENS_VERSION__ === 'string' ? __RERENDER_LENS_VERSION__ : 'dev';
