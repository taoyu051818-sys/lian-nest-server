import { Global, Module } from '@nestjs/common';
import type { InjectionToken, OptionalFactoryDependency } from '@nestjs/common';
import { NodebbAuthMode, normalizeOk, normalizeError } from './types';
import type { NodebbAuth, NodebbNormalizedResponse } from './types';
import { NodebbClient, NODEBB_CLIENT } from './nodebb-client';
import { NodebbTopicsProvider } from './providers/nodebb-topics.provider';
import { NodebbPostsProvider } from './providers/nodebb-posts.provider';
import { NodebbUsersProvider } from './providers/nodebb-users.provider';
import { NodebbNotificationsProvider } from './providers/nodebb-notifications.provider';
import { NodebbTagsProvider } from './providers/nodebb-tags.provider';
import { NodebbCategoriesProvider } from './providers/nodebb-categories.provider';
import { NodebbSearchProvider } from './providers/nodebb-search.provider';
import { NodebbChatsProvider } from './providers/nodebb-chats.provider';

interface NodebbModuleAsyncOptions {
  useFactory: (...args: unknown[]) => NodebbModuleConfig;
  inject?: (InjectionToken | OptionalFactoryDependency)[];
}

// ---------------------------------------------------------------------------
// Module configuration
// ---------------------------------------------------------------------------

export interface NodebbModuleConfig {
  baseUrl: string;
  authMode: NodebbAuthMode;
  apiToken?: string;
  sessionCookie?: string;
}

// ---------------------------------------------------------------------------
// Concrete client — private to this module
// ---------------------------------------------------------------------------

class NodebbHttpClient extends NodebbClient {
  private readonly apiBase: string;

  constructor(private readonly config: NodebbModuleConfig) {
    super();
    this.apiBase = config.baseUrl.replace(/\/+$/, '');
  }

  async get<T>(
    path: string,
    auth?: NodebbAuth,
  ): Promise<NodebbNormalizedResponse<T>> {
    return this.request<T>('GET', path, undefined, auth);
  }

  async post<T>(
    path: string,
    body: unknown,
    auth?: NodebbAuth,
  ): Promise<NodebbNormalizedResponse<T>> {
    return this.request<T>('POST', path, body, auth);
  }

  async put<T>(
    path: string,
    body: unknown,
    auth?: NodebbAuth,
  ): Promise<NodebbNormalizedResponse<T>> {
    return this.request<T>('PUT', path, body, auth);
  }

  async delete<T>(
    path: string,
    auth?: NodebbAuth,
  ): Promise<NodebbNormalizedResponse<T>> {
    return this.request<T>('DELETE', path, undefined, auth);
  }

  // -- internals ------------------------------------------------------------

  private buildAuthHeaders(
    auth?: NodebbAuth,
  ): Record<string, string> {
    const effective = auth ?? {
      mode: this.config.authMode,
      token: this.config.apiToken,
      sessionCookie: this.config.sessionCookie,
    };

    switch (effective.mode) {
      case NodebbAuthMode.API_TOKEN:
        return effective.token
          ? { Authorization: `Bearer ${effective.token}` }
          : {};
      case NodebbAuthMode.SESSION:
        return effective.sessionCookie
          ? { Cookie: effective.sessionCookie }
          : {};
      case NodebbAuthMode.NONE:
      default:
        return {};
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body: unknown,
    auth?: NodebbAuth,
  ): Promise<NodebbNormalizedResponse<T>> {
    const url = `${this.apiBase}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.buildAuthHeaders(auth),
    };

    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const response = await fetch(url, init);
    return this.handleResponse<T>(response, url);
  }

  private async handleResponse<T>(
    response: Response,
    url: string,
  ): Promise<NodebbNormalizedResponse<T>> {
    const { status } = response;

    if (!response.ok) {
      let message: string;
      try {
        const errBody = await response.json() as Record<string, unknown>;
        message =
          (errBody.message as string) ??
          (errBody.error as string) ??
          `NodeBB error ${status}`;
      } catch {
        message = `NodeBB error ${status} at ${url}`;
      }
      return normalizeError<T>(status, message);
    }

    const json = (await response.json()) as Record<string, unknown>;
    const payload =
      json.response !== undefined
        ? (json.response as T)
        : (json as unknown as T);
    return normalizeOk<T>(payload, status);
  }
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const NODEBB_MODULE_CONFIG = 'NODEBB_MODULE_CONFIG';

@Global()
@Module({})
export class NodebbModule {
  static register(config: NodebbModuleConfig) {
    if (!config.baseUrl) {
      throw new Error(
        'NodebbModule.register() requires a non-empty baseUrl',
      );
    }

    return {
      module: NodebbModule,
      providers: [
        { provide: NODEBB_MODULE_CONFIG, useValue: config },
        {
          provide: NODEBB_CLIENT,
          useFactory: (cfg: NodebbModuleConfig) => new NodebbHttpClient(cfg),
          inject: [NODEBB_MODULE_CONFIG],
        },
        NodebbTopicsProvider,
        NodebbPostsProvider,
        NodebbUsersProvider,
        NodebbNotificationsProvider,
        NodebbTagsProvider,
        NodebbCategoriesProvider,
        NodebbSearchProvider,
        NodebbChatsProvider,
      ],
      exports: [
        NODEBB_CLIENT,
        NodebbTopicsProvider,
        NodebbPostsProvider,
        NodebbUsersProvider,
        NodebbNotificationsProvider,
        NodebbTagsProvider,
        NodebbCategoriesProvider,
        NodebbSearchProvider,
        NodebbChatsProvider,
      ],
    };
  }

  static registerAsync(options: NodebbModuleAsyncOptions) {
    return {
      module: NodebbModule,
      providers: [
        {
          provide: NODEBB_MODULE_CONFIG,
          useFactory: options.useFactory,
          inject: options.inject ?? [],
        },
        {
          provide: NODEBB_CLIENT,
          useFactory: (cfg: NodebbModuleConfig) => new NodebbHttpClient(cfg),
          inject: [NODEBB_MODULE_CONFIG],
        },
        NodebbTopicsProvider,
        NodebbPostsProvider,
        NodebbUsersProvider,
        NodebbNotificationsProvider,
        NodebbTagsProvider,
        NodebbCategoriesProvider,
        NodebbSearchProvider,
        NodebbChatsProvider,
      ],
      exports: [
        NODEBB_CLIENT,
        NodebbTopicsProvider,
        NodebbPostsProvider,
        NodebbUsersProvider,
        NodebbNotificationsProvider,
        NodebbTagsProvider,
        NodebbCategoriesProvider,
        NodebbSearchProvider,
        NodebbChatsProvider,
      ],
    };
  }
}
