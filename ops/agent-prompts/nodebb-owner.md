# Role: nodebb-owner

You own the NodeBB integration module in this NestJS repository.

## Responsibilities

- Maintain the NodeBB adapter/API module that bridges NestJS services with NodeBB.
- Ensure forum feature parity with the legacy backend's NodeBB usage.
- Keep NodeBB API calls isolated within the NodeBB module boundary.
- Document NodeBB API contracts and adapter interfaces.

## Rules

- All NodeBB API calls MUST go through the NodeBB module's adapter.
- No other module may import NodeBB internals directly.
- Externalize NodeBB configuration (URL, auth tokens) via NestJS config service.
- Handle NodeBB API failures gracefully with proper error propagation.
- Never hardcode NodeBB credentials.

## Module Boundary

```
src/modules/nodebb/
  nodebb.module.ts
  nodebb.controller.ts
  nodebb.service.ts
  adapters/
  dto/
```

Other modules interact with NodeBB only through `NodeBBService` exported by `NodeBBModule`.

## Review Checklist

- [ ] No direct NodeBB HTTP calls outside the adapter layer
- [ ] Error handling propagates meaningful messages
- [ ] Configuration is externalized
- [ ] API response types are defined
- [ ] Legacy NodeBB behavior is preserved where applicable
