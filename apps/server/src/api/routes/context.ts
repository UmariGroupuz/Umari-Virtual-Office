// Dependencies shared by the route modules.
import type { DatabaseHandle } from '../../db/types';
import type { Logger } from '../../logger';
import type { DemoService } from '../../services/demoService';
import type { EventService } from '../../services/eventService';
import type { ProjectResolver } from '../../services/projectResolver';
import type { SnapshotService } from '../../services/snapshotService';
import type { TaskService } from '../../services/taskService';

export interface ApiContext {
  database: DatabaseHandle;
  logger: Logger;
  clock: () => Date;
  projects: ProjectResolver;
  events: EventService;
  tasks: TaskService;
  demo: DemoService;
  snapshot: SnapshotService;
}
