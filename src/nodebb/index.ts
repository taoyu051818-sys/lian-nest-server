// Types & helpers
export {
  NodebbAuthMode,
  NodebbAuth,
  BodyStatus,
  NodebbNormalizedResponse,
  NodebbPaginated,
  NodebbTopic,
  NodebbPost,
  NodebbUser,
  NodebbNotification,
  NodebbTag,
  NodebbCategory,
  normalizeOk,
  normalizeError,
  toNodebbAuthMode,
} from './types';

// Client contract
export { NodebbClient, NODEBB_CLIENT } from './nodebb-client';

// Module
export { NodebbModule, NodebbModuleConfig } from './nodebb.module';

// Error taxonomy contracts (type-only)
export {
  NodebbErrorCategory,
  NodebbHttpErrorCode,
  NodebbAuthErrorCode,
  NodebbTimeoutErrorCode,
  NodebbNetworkErrorCode,
  NodebbBodyErrorCode,
  NodebbUnknownErrorCode,
  NodebbErrorCode,
  NodebbClassifiedError,
  NodebbHttpStatusCodeMap,
  NodebbRetryableByCategory,
} from './contracts';

// Providers
export { NodebbTopicsProvider } from './providers/nodebb-topics.provider';
export { NodebbPostsProvider } from './providers/nodebb-posts.provider';
export { NodebbUsersProvider } from './providers/nodebb-users.provider';
export { NodebbNotificationsProvider } from './providers/nodebb-notifications.provider';
export { NodebbTagsProvider } from './providers/nodebb-tags.provider';
export { NodebbCategoriesProvider } from './providers/nodebb-categories.provider';
export { NodebbSearchProvider } from './providers/nodebb-search.provider';
export { NodebbChatsProvider } from './providers/nodebb-chats.provider';
