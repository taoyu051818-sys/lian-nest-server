import { NodebbAuth, NodebbNormalizedResponse } from './types';

/**
 * Injection token — use to inject the concrete NodeBB HTTP client.
 *
 *   @Inject(NODEBB_CLIENT) private readonly client: NodebbClient
 */
export const NODEBB_CLIENT = 'NODEBB_CLIENT';

/**
 * Abstract contract for every outbound call to the NodeBB API.
 *
 * Business modules inject this class; the concrete implementation lives
 * exclusively inside NodebbModule so that no raw HTTP call can happen
 * outside the module boundary.
 */
export abstract class NodebbClient {
  abstract get<T>(
    path: string,
    auth?: NodebbAuth,
  ): Promise<NodebbNormalizedResponse<T>>;

  abstract post<T>(
    path: string,
    body: unknown,
    auth?: NodebbAuth,
  ): Promise<NodebbNormalizedResponse<T>>;

  abstract put<T>(
    path: string,
    body: unknown,
    auth?: NodebbAuth,
  ): Promise<NodebbNormalizedResponse<T>>;

  abstract delete<T>(
    path: string,
    auth?: NodebbAuth,
  ): Promise<NodebbNormalizedResponse<T>>;
}
