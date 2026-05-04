---
layout: default
title: "Cache"
parent: "How To"
nav_order: 23
description: "How to wire a Redis or Valkey cache into a ColdBrew service: client init in PreStart, drain in Stop, cache-aside, and tracing via NewDatastoreSpan"
---
# Cache

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

ColdBrew is cache-agnostic — `core` does not import a Redis client and the cookiecutter does not pick one. The same lifecycle pattern as [Database](/howto/database) applies: open the client in `PreStart`, close it in `Stop`, and wrap each call with `tracing.NewDatastoreSpan`.

This page shows the framework pattern with a Redis / Valkey example using [go-redis]. Memcached or any other cache works the same way — swap the client.

## The pattern

```text
PreStart  → open the client, run a Ping
Stop      → close the client
NewDatastoreSpan around each call → tracing
```

Same three interfaces as the database page:

- [`CBPreStarter.PreStart(ctx) error`](https://pkg.go.dev/github.com/go-coldbrew/core#CBPreStarter)
- [`CBStopper.Stop()`](https://pkg.go.dev/github.com/go-coldbrew/core#CBStopper)
- [`tracing.NewDatastoreSpan(ctx, datastore, operation, collection)`](https://pkg.go.dev/github.com/go-coldbrew/tracing#NewDatastoreSpan)

## Redis / Valkey with go-redis

[Valkey](https://valkey.io/) is the open-source fork of Redis 7; the wire protocol is identical, so the same client library works against either.

Start the container:

```bash
make local-stack PROFILES=redis
# or, identically:
make local-stack PROFILES=valkey
```

The `redis` profile exposes port `6379`; the `valkey` profile exposes port `6380` so the two can run side by side. See [Local Development](/howto/local-dev#cache) for the full port list.

### Add the config field

The cookiecutter `config/` package embeds the framework's `cbConfig.Config` and lets you add fields with `envconfig` tags. Add the cache fields there:

```go
// config/config.go
type Config struct {
    cbConfig.Config
    auth.AuthConfig

    RedisAddr      string `envconfig:"REDIS_ADDR" required:"true"`
    RedisPoolSize  int    `envconfig:"REDIS_POOL_SIZE" default:"20"`
}
```

Set the value the same way as any other env var:

```bash
export REDIS_ADDR=localhost:6379
```

### Wire the client

```go
package svc

import (
    "context"
    "fmt"
    "time"

    "github.com/go-coldbrew/core"
    "github.com/redis/go-redis/v9"

    "myapp/config" // import path of your service's config package
)

type Service struct {
    cache *redis.Client
}

var (
    _ core.CBPreStarter = (*Service)(nil)
    _ core.CBStopper    = (*Service)(nil)
)

func (s *Service) PreStart(ctx context.Context) error {
    cfg := config.Get()
    s.cache = redis.NewClient(&redis.Options{
        Addr:         cfg.RedisAddr,
        DialTimeout:  2 * time.Second,
        ReadTimeout:  500 * time.Millisecond,
        WriteTimeout: 500 * time.Millisecond,
        PoolSize:     cfg.RedisPoolSize,
        MinIdleConns: 2,
    })
    if err := s.cache.Ping(ctx).Err(); err != nil {
        s.cache.Close()
        return fmt.Errorf("redis ping: %w", err)
    }
    return nil
}

func (s *Service) Stop() {
    if s.cache != nil {
        s.cache.Close()
    }
}
```

A failed Ping at startup returns from `PreStart`, which aborts the whole service — exactly the right behaviour when the cache is required. If the cache is **optional** (cache-aside, see below), log the error and proceed; treat cache misses as the empty case.

### Trace each call

Same `NewDatastoreSpan` helper as a database query, with `"redis"` as the datastore:

```go
func (s *Service) GetSession(ctx context.Context, sid string) (*Session, error) {
    span, ctx := tracing.NewDatastoreSpan(ctx, "redis", "GET", "session")
    defer span.End()
    span.SetTag("session_id", sid)

    raw, err := s.cache.Get(ctx, "session:"+sid).Bytes()
    if err == redis.Nil {
        return nil, nil // miss — caller decides what "not found" means
    }
    if err != nil {
        span.SetError(err)
        return nil, err
    }
    var sess Session
    if err := proto.Unmarshal(raw, &sess); err != nil {
        span.SetError(err)
        return nil, err
    }
    return &sess, nil
}
```

`redis.Nil` is the **expected** "key not found" sentinel — surface it as a miss, not an error, so a cache miss doesn't show up as a failure in your error rate.

## Cache-aside pattern

Cache-aside (lazy population) is the right default for most read-heavy workloads: try the cache first, fall back to the source of truth on a miss, populate the cache on the way back, and tolerate the cache being down.

```go
func (s *Service) GetUser(ctx context.Context, id int64) (*User, error) {
    key := fmt.Sprintf("user:%d", id)

    // 1. Try the cache. A failure here is logged and treated as a miss —
    //    the source of truth still works.
    if u, err := s.cacheGetUser(ctx, key); err == nil && u != nil {
        return u, nil
    } else if err != nil {
        log.GetLogger(ctx).Warn("cache get failed", "err", err)
    }

    // 2. Source of truth.
    u, err := s.dbGetUser(ctx, id)
    if err != nil || u == nil {
        return u, err
    }

    // 3. Populate the cache. Failure to populate is non-fatal.
    if err := s.cacheSetUser(ctx, key, u); err != nil {
        log.GetLogger(ctx).Warn("cache set failed", "err", err)
    }
    return u, nil
}
```

Two principles to keep in mind:

- **Cache failures must not fail the request.** A degraded cache should turn into higher database load, not 5xx errors.
- **Pick a TTL up front, not by accident.** `SET key value EX 300` (5 minutes) for human-scale data; longer for immutable data; explicit `Del` on writes for anything that *must* invalidate. Avoid relying on memory pressure for eviction — the data you need evicted first is rarely the data Redis evicts first.

## Invalidation

Cache invalidation is the hard part. Two patterns work in practice for ColdBrew services:

- **Write-through invalidation.** When the source of truth changes, the same handler explicitly `Del`s the cache key. Simple, correct as long as you remember to do it everywhere.
- **TTL-based.** Set a short TTL and accept stale data within that window. Trivially correct; the trade-off is staleness.

Pub/sub-based invalidation across replicas is possible but brittle in a microservice setting. If you find yourself reaching for it, consider whether your service should own the cache at all, or whether a CDN / fronting service is the better tool.

## Local stack profiles

| Profile | Service | Port |
|---|---|---|
| `redis` | Redis 8 | 6379 |
| `valkey` | Valkey 8 (Redis-compatible) | 6380 |
| `memcached` | Memcached | 11211 |

See [Local Development](/howto/local-dev) for the full profile list.

## Other caches

- **Memcached** — use [bradfitz/gomemcache] or [rainycape/memcache]. Same `PreStart`/`Stop` pattern; client is a value, no explicit pool. Use `tracing.NewDatastoreSpan(ctx, "memcached", "GET", key)`.
- **In-process / LRU** — [hashicorp/golang-lru] or stdlib `sync.Map` with eviction. No `PreStart` needed (just construct in your service factory). Tracing is optional since the call doesn't cross process boundaries.
- **Multi-tier (in-process → Redis)** — wrap two clients behind one interface. Trace each tier separately so you can see the hit ratio at each level.

## Related

- [Database](/howto/database) — Same lifecycle pattern, different client.
- [Tracing](/howto/Tracing) — How `NewDatastoreSpan` fits into the broader tracing model.
- [Local Development](/howto/local-dev) — All local-stack profiles.
- [Shutdown Lifecycle](/howto/signals) — Full lifecycle interface table.

[go-redis]: https://github.com/redis/go-redis
[bradfitz/gomemcache]: https://github.com/bradfitz/gomemcache
[rainycape/memcache]: https://github.com/rainycape/memcache
[hashicorp/golang-lru]: https://github.com/hashicorp/golang-lru
