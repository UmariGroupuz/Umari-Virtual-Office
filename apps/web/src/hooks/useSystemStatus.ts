import { useOffice } from '../lib/runtime';
import { selectSystemStatus, type SystemStatus } from '../store/selectors';

/** Top-bar system status (UX §11.1). */
export function useSystemStatus(): SystemStatus {
  const health = useOffice((s) => s.connection.health);
  const socket = useOffice((s) => s.connection.socket);
  return selectSystemStatus(health, socket);
}

/** Backend unavailable → actions are paused (UX §11.3). */
export function useBackendUnavailable(): boolean {
  return useOffice((s) => s.connection.health === 'failing');
}
