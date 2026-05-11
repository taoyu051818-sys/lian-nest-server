# Initial Schema Slices

These are the first schema slices to implement after the Prisma DatabaseModule is bootstrapped. Each slice corresponds to one or more GitHub issues and should be implemented as a separate PR.

## Slice 1: Users

Core user identity for LIAN, with NodeBB reference.

```prisma
model User {
  id          Int       @id @default(autoincrement())
  uuid        String    @unique @db.Uuid
  email       String    @unique
  username    String    @unique
  displayName String?   @map("display_name")
  avatarUrl   String?   @map("avatar_url")
  passwordHash String   @map("password_hash")
  role        UserRole  @default(USER)
  status      UserStatus @default(ACTIVE)

  // NodeBB reference
  nodebbUid   Int?      @map("nodebb_uid")

  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")

  @@map("users")
}

enum UserRole {
  USER
  MODERATOR
  ADMIN
}

enum UserStatus {
  ACTIVE
  SUSPENDED
  DELETED
}
```

## Slice 2: Sessions

Session metadata and refresh tokens. JWT access tokens are stateless; refresh tokens and deny-lists live here.

```prisma
model Session {
  id           String    @id @default(cuid())
  userId       Int       @map("user_id")
  refreshToken String    @unique @map("refresh_token")
  userAgent    String?   @map("user_agent")
  ipAddress    String?   @map("ip_address")
  expiresAt    DateTime  @map("expires_at")
  createdAt    DateTime  @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("sessions")
}
```

## Slice 3: Post Metadata

LIAN-side metadata for content that bridges to NodeBB topics/posts. Does not duplicate NodeBB content — stores only the reference and LIAN-specific fields.

```prisma
model PostMeta {
  id          Int       @id @default(autoincrement())
  authorId    Int       @map("author_id")
  title       String
  slug        String    @unique
  category    String?
  tags        String[]
  status      PostStatus @default(DRAFT)

  // NodeBB references
  nodebbTid   Int?      @map("nodebb_tid")
  nodebbPid   Int?      @map("nodebb_pid")
  nodebbSlug  String?   @map("nodebb_slug")

  publishedAt DateTime? @map("published_at")
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")

  author User @relation(fields: [authorId], references: [id])

  @@index([authorId])
  @@index([status])
  @@map("post_meta")
}

enum PostStatus {
  DRAFT
  PUBLISHED
  ARCHIVED
}
```

## Slice 4: Recommendation Preferences

User preferences that feed the recommendation engine.

```prisma
model RecommendationPref {
  id        Int      @id @default(autoincrement())
  userId    Int      @unique @map("user_id")
  interests String[]
  weights   Json     // flexible weight vector for recommendation model
  updatedAt DateTime @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("recommendation_prefs")
}
```

## Slice 5: AI Interaction Records

Logs of AI-powered features (content suggestions, auto-tagging, moderation flags).

```prisma
model AiInteraction {
  id        String   @id @default(cuid())
  userId    Int?     @map("user_id")
  feature   String   // e.g. "auto_tag", "content_suggest", "moderation_flag"
  input     Json
  output    Json
  model     String   // e.g. "gpt-4", "claude-3"
  tokens    Int?
  latencyMs Int?     @map("latency_ms")
  createdAt DateTime @default(now()) @map("created_at")

  user User? @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([userId])
  @@index([feature])
  @@map("ai_interactions")
}
```

## Slice 6: Audit Events

Append-only log of significant actions for compliance and debugging.

```prisma
model AuditEvent {
  id        String   @id @default(cuid())
  actorId   Int?     @map("actor_id")
  action    String   // e.g. "user.login", "post.publish", "admin.role_change"
  target    String?  // e.g. "user:42", "post_meta:107"
  detail    Json?
  ipAddress String?  @map("ip_address")
  createdAt DateTime @default(now()) @map("created_at")

  actor User? @relation(fields: [actorId], references: [id], onDelete: SetNull)

  @@index([actorId])
  @@index([action])
  @@index([createdAt])
  @@map("audit_events")
}
```

## Notes

- All `@map` directives use snake_case for Postgres column names while keeping camelCase in TypeScript.
- All timestamps are stored as `DateTime` (Postgres `timestamptz`).
- Cascade deletes are explicit where the child has no meaning without the parent (sessions, prefs). Set null where the record should survive user deletion (AI interactions, audit events).
- JSON columns (`weights`, `input`, `output`, `detail`) provide flexibility for evolving structure without schema migrations. These should be validated at the application layer.
- These slices are initial — they will be refined during implementation PRs as edge cases emerge.
