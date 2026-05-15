// Provide deterministic test env defaults so AppModule compile tests
// do not require a developer-supplied DATABASE_URL.
process.env.DATABASE_URL ??= 'postgresql://localhost:5432/test';
process.env.JWT_SECRET ??= 'test-secret-key-for-unit-tests-only-32chars!';
