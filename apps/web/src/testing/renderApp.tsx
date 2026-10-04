// TEST-ONLY: renders the whole app with an injected runtime (fake socket + mocked API).
import { act, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import type { OfficeApi } from '../api/endpoints';
import { createRuntime, type AppRuntime } from '../lib/runtime';
import type { UiState } from '../store/store';
import { createFakeApi, FakeSocket, type FakeApi } from './fakes';

export interface RenderAppOptions {
  api?: Partial<OfficeApi>;
  ui?: Partial<UiState>;
  width?: number;
  height?: number;
  /** Emit `connect` on the fake socket right after start (default true). */
  connect?: boolean;
  urlSync?: boolean;
  userEventOptions?: Parameters<typeof userEvent.setup>[0];
}

export function setViewport(width: number, height = 900): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    writable: true,
    value: height,
  });
  window.dispatchEvent(new Event('resize'));
}

const runtimes: AppRuntime[] = [];

/** Stops every runtime created by renderApp (call in afterEach). */
export function stopRuntimes(): void {
  while (runtimes.length > 0) runtimes.pop()?.stop();
}

export async function renderApp(options: RenderAppOptions = {}) {
  setViewport(options.width ?? 1440, options.height ?? 900);
  const socket = new FakeSocket();
  const api: FakeApi & OfficeApi = createFakeApi(options.api);
  const runtime = createRuntime({
    api,
    socket,
    ui: options.ui,
    urlSync: options.urlSync ?? false,
  });
  runtimes.push(runtime);
  const user = userEvent.setup(options.userEventOptions);
  const utils = render(<App runtime={runtime} />);
  if (options.connect ?? true) {
    await act(async () => {
      socket.serverConnect();
      await flushMicrotasks();
    });
  }
  // Let the initial snapshot/health/feed promises settle (works with real and fake timers).
  await settle();
  return { ...utils, runtime, socket, api, user };
}

/** Resolves pending promise chains of the mocked API without relying on timers. */
export async function flushMicrotasks(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

export async function settle(): Promise<void> {
  await act(async () => {
    await flushMicrotasks();
  });
}
