import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeChrome, settle, type FakeChrome } from './fake-chrome';

const shared = readFileSync(join(__dirname, '..', 'shared.js'), 'utf8');
const background = readFileSync(join(__dirname, '..', 'background.js'), 'utf8');
const popup = readFileSync(join(__dirname, '..', 'popup.js'), 'utf8');

/** Loads background (for the message handlers) and the popup against the same fake chrome. */
function load(chrome: FakeChrome) {
  new Function('chrome', 'self', 'importScripts', `${shared}\n${background}`)(chrome, { RerenderLensShared: undefined }, undefined);
  document.body.innerHTML = '<div id="root"></div>';
  const w = window as unknown as Record<string, unknown>;
  delete w.RerenderLensShared;
  new Function('chrome', 'window', shared)(chrome, window);
  new Function('chrome', 'window', 'document', popup)(chrome, window, document);
}

const labelInput = (text: string) => [...document.querySelectorAll('label')].find((l) => l.textContent!.includes(text))!.querySelector('input') as HTMLInputElement;

describe('popup', () => {
  let chrome: FakeChrome;
  beforeEach(() => {
    document.documentElement.className = '';
  });

  it('shows a hint on non-http pages', async () => {
    chrome = makeChrome({ activeUrl: 'chrome://extensions' });
    load(chrome);
    await settle();
    expect(document.body.textContent).toContain('Open an http(s) page');
  });

  it('local hosts are enabled and read-only; injection can be toggled and needs a reload', async () => {
    chrome = makeChrome({ activeUrl: 'http://localhost:5199/app' });
    load(chrome);
    await settle();
    expect(document.querySelector('.origin')!.textContent).toBe('http://localhost:5199');
    const enabled = labelInput('Enabled (local development host)');
    expect(enabled.checked).toBe(true);
    expect(enabled.disabled).toBe(true);
    const inject = labelInput('Inject the library');
    expect(inject.checked).toBe(false);
    expect(inject.disabled).toBe(false);
    expect(labelInput('Let React DevTools').disabled).toBe(true);
    inject.checked = true;
    inject.dispatchEvent(new Event('change'));
    await settle();
    await settle();
    expect(chrome._store.origins).toEqual({ 'http://localhost:5199': { inject: true, deferHook: false } });
    expect(document.body.textContent).toContain('Reload the page');
    const defer = labelInput('Let React DevTools');
    expect(defer.disabled).toBe(false);
    defer.checked = true;
    defer.dispatchEvent(new Event('change'));
    await settle();
    await settle();
    expect(chrome._store.origins).toEqual({ 'http://localhost:5199': { inject: true, deferHook: true } });
  });

  it('enabling a remote site requests the host permission first, then registers the relay', async () => {
    chrome = makeChrome({ activeUrl: 'https://app.example.com/dashboard?x=1' });
    load(chrome);
    await settle();
    const enabled = labelInput('Enable on this site');
    expect(enabled.checked).toBe(false);
    enabled.checked = true;
    enabled.dispatchEvent(new Event('change'));
    await settle();
    await settle();
    expect(chrome.permissions.request).toHaveBeenCalledWith({ origins: ['https://app.example.com/*'] });
    expect([...chrome._registered.keys()]).toEqual(['relay:https://app.example.com']);
    expect(chrome._store.origins).toEqual({ 'https://app.example.com': { inject: false, deferHook: false } });
    expect(labelInput('Enable on this site').checked).toBe(true);
  });

  it('declining the permission leaves the site disabled and says so', async () => {
    chrome = makeChrome({ activeUrl: 'https://app.example.com/' });
    chrome.permissions.request.mockImplementation(() => Promise.resolve(false));
    load(chrome);
    await settle();
    const enabled = labelInput('Enable on this site');
    enabled.checked = true;
    enabled.dispatchEvent(new Event('change'));
    await settle();
    await settle();
    expect(document.querySelector('.err')!.textContent).toBe('Permission was not granted.');
    expect(labelInput('Enable on this site').checked).toBe(false);
    expect(chrome._registered.size).toBe(0);
  });
});
