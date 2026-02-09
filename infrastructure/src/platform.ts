import * as pulumi from '@pulumi/pulumi';
import { deploy } from './deploy.ts';

// --- [ENTRY_POINT] -----------------------------------------------------------

const deployment = deploy({ env: process.env, stack: pulumi.getStack() });

// --- [EXPORT] ----------------------------------------------------------------

export { deployment };
