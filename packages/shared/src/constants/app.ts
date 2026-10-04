// Application-wide constants (API_CONTRACTS §5.2, §4, §11).

export const APP_NAME = 'AI Virtual Office';
export const APP_VERSION = '0.1.0';
export const API_PREFIX = '/api';
export const SOCKET_PATH = '/socket.io';
export const SOCKET_EVENTS = {
  OFFICE_EVENT: 'office:event',
  DEMO_STATE: 'demo:state',
  OFFICE_RESYNC: 'office:resync',
} as const;
export const DEFAULT_SERVER_PORT = 4000;
export const DEFAULT_WEB_PORT = 5173;
