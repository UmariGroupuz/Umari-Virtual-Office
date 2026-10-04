// Project entity (API_CONTRACTS §1.3).

export interface Project {
  id: string; // 'sellway' | 'ishkun24' | 'erp' | 'ana-market' in Phase 1
  name: string; // 'Sellway' …
  taskPrefix: string; // 'SW' | 'IK' | 'ERP' | 'AM'
}
