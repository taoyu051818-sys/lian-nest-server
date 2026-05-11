# MessagesModule Contract

## Overview

MessagesModule provides the skeleton for messages and notifications functionality in the LIAN Nest server. This module defines the contract for future integration with NodeBB's messaging and notification APIs.

## Module Structure

```
src/messages/
├── controllers/
│   ├── messages.controller.ts      # REST endpoints for messages
│   └── notifications.controller.ts # REST endpoints for notifications
├── dto/
│   ├── message.dto.ts              # Message request/response DTOs
│   └── notification.dto.ts         # Notification request/response DTOs
├── use-cases/
│   ├── messages.use-case.ts        # Business logic for messages
│   └── notifications.use-case.ts   # Business logic for notifications
├── messages.module.ts              # Module definition
├── messages.controller.spec.ts     # Module-local tests
└── index.ts                        # Public API exports
```

## API Endpoints

### Messages

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/messages` | Send a message |
| GET | `/api/messages` | List messages (paginated) |
| POST | `/api/messages/:messageId/read` | Mark message as read |

### Notifications

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/notifications` | List notifications |
| GET | `/api/notifications/unread-count` | Get unread notification count |
| POST | `/api/notifications/:nid/read` | Mark notification as read |

## Integration Points

### NodeBB Notification Provider

The `NotificationsUseCase` is designed to delegate to `NodebbNotificationsProvider` from `NodebbModule`:

- `listNotifications()` → `NodebbNotificationsProvider.list()`
- `markRead()` → `NodebbNotificationsProvider.markRead()`

**Status**: Awaiting auth mode resolution before wiring.

### NodeBB Messages API

The `MessagesUseCase` is designed to integrate with NodeBB's chat/message API:

- `sendMessage()` → NodeBB chat API
- `listMessages()` → NodeBB chat API
- `markRead()` → NodeBB chat API

**Status**: Awaiting NodeBB message provider implementation.

## Follow-ups

### Auth Mode Resolution

Before notifications can be wired to NodeBB, the auth mode must be resolved:

1. Determine if notifications use API_TOKEN or SESSION auth
2. Extract user context (uid) from request authentication
3. Pass appropriate `NodebbAuth` to provider calls

### Notification Parity

Define notification parity requirements:

1. Which NodeBB notification types to expose
2. Notification filtering/routing rules
3. Push notification integration (if applicable)
4. Notification preferences/permissions

## Testing

All tests are module-local and deterministic:

- Controller methods throw "Not implemented" errors
- No live NodeBB calls are made
- Tests verify module composition and method signatures

## Usage

To use MessagesModule in the application, import it into AppModule:

```typescript
import { MessagesModule } from './messages/messages.module';

@Module({
  imports: [MessagesModule],
})
export class AppModule {}
```

**Note**: This wiring is deferred to a later aggregation task (issue #4).
