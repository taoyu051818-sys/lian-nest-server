# ORM Recommendation

## Candidates

Three ORMs were evaluated for the LIAN Nest server: **Prisma**, **Drizzle**, and **TypeORM**.

## Comparison

| Criteria | Prisma | Drizzle | TypeORM |
|---|---|---|---|
| **Type safety** | Excellent — generated client, full inference from schema | Excellent — TypeScript-native, zero-codegen inference | Moderate — decorators, runtime reflection, manual typing |
| **Schema definition** | `.prisma` DSL (own language) | TypeScript code (co-located with app) | Decorators on entity classes |
| **Migration workflow** | `prisma migrate` — mature, auto-generated SQL | `drizzle-kit` — generates SQL from TS diffs | Built-in `migration:generate`, less mature |
| **NestJS integration** | Official `@nestjs/prisma` + `@prisma/client` | Manual service wrapper (thin) | `@nestjs/typeorm` — first-class, mature |
| **Query flexibility** | Prisma Client (structured API) + raw SQL escape hatch | Full SQL power, composable query builder | QueryBuilder + raw SQL |
| **Performance** | Good; connection pooling via Prisma engine | Excellent; minimal overhead, direct SQL | Good; connection pooling via driver |
| **Learning curve** | Low for simple models, moderate for advanced | Low for SQL-familiar devs | Moderate; decorator patterns add ceremony |
| **Community / maturity** | Large, fast-growing, Vercel-backed | Growing rapidly, lightweight ethos | Mature, large, but slower development pace |
| **Edge/serverless fit** | Good (Prisma Accelerate, edge client) | Excellent (no binary engine, light bundle) | Poor (heavy, not edge-friendly) |
| **Raw SQL escape hatch** | `$queryRaw`, `$executeRaw` | Native SQL template tags | `query()` on connection |

## Recommendation: Prisma

**Prisma is recommended for the LIAN Nest server.**

### Rationale

1. **Type safety without ceremony.** Prisma generates a fully typed client from the schema file. Every query result is inferred — no manual interface updates when a column changes. This matches the AI-native workflow where schema evolves through issues and PRs.

2. **Schema as a single source.** The `.prisma` file is a clear, diffable contract. It reads well in code review and maps directly to SQL migrations. This aligns with the "small PRs" rule in the SOP — schema changes are isolated and reviewable.

3. **NestJS ecosystem.** `@nestjs/prisma` provides a ready-made PrismaModule, PrismaService, and testing utilities. Less glue code means faster bootstrap.

4. **Migration confidence.** `prisma migrate` generates deterministic SQL, supports shadow databases for drift detection, and produces migration files that can be reviewed before apply. This matters for a project that will run alongside a legacy system.

5. **Query flexibility when needed.** Prisma's structured API covers 90% of queries. For the remaining 10% (complex aggregations, CTEs, window functions), `$queryRaw` and `$queryRawUnsafe` provide full SQL access without switching tools.

### When Drizzle Would Win

If the team prioritized minimal abstraction, zero codegen, and maximum SQL control from day one, Drizzle would be the better pick. It is lighter, more composable, and closer to raw SQL. For a greenfield project with a SQL-explicit team, Drizzle is a strong alternative.

If during bootstrap the team finds Prisma's generated client limiting or the engine overhead unacceptable, switching to Drizzle is a viable mid-course correction — both tools produce standard SQL migrations.

### When TypeORM Would Win

TypeORM is the right choice only if the team has deep existing TypeORM expertise and values decorator-based entity modeling. For a new Nest project without legacy TypeORM code, its advantages do not outweigh its weaker type inference and slower development pace.

## Implementation Notes

- Use `prisma/schema.prisma` as the schema definition file.
- Use `prisma/migrations/` for versioned SQL migrations.
- Expose PrismaService as a global injectable via `@nestjs/prisma`.
- Repository classes wrap PrismaService calls — no direct Prisma usage in controllers or services.
- Use `$queryRaw` for any query that Prisma's API cannot express cleanly.
