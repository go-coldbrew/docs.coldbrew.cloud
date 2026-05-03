---
layout: default
title: "Database"
parent: "How To"
nav_order: 22
description: "How to wire a database connection pool into a ColdBrew service: pool init in PreStart, drain in Stop, and tracing via NewDatastoreSpan. Library-agnostic with a pgx Postgres example"
---
# Database

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

ColdBrew is database-agnostic — `core` does not import a SQL driver and the cookiecutter does not pick one for you. Instead, the framework gives you the lifecycle hooks you need to wire any client cleanly: open the pool when the service starts, close it on shutdown, and trace every query.

This page shows the framework pattern and a runnable Postgres example using [pgx]. The same shape works for MySQL, CockroachDB, AlloyDB, Spanner, or anything else — swap the driver, keep the hooks.

## The pattern

```text
PreStart  → open the pool, run a ping
Stop      → close the pool
NewDatastoreSpan around each query → tracing + metrics
```

Three interfaces from `go-coldbrew/core` carry the work:

- [`CBPreStarter.PreStart(ctx) error`](https://pkg.go.dev/github.com/go-coldbrew/core#CBPreStarter) — runs **before** servers listen. Returning an error aborts startup, so this is the right place to fail-fast if the database is unreachable.
- [`CBStopper.Stop()`](https://pkg.go.dev/github.com/go-coldbrew/core#CBStopper) — runs after servers stop accepting new RPCs. Close the pool here so in-flight queries drain first.
- [`tracing.NewDatastoreSpan(ctx, datastore, operation, collection)`](https://pkg.go.dev/github.com/go-coldbrew/tracing#NewDatastoreSpan) — wrap each query so it shows up in the trace tree as a child of the gRPC span.

See [Service lifecycle interfaces](/howto/signals#service-lifecycle-interfaces) for the full hook list.

## Postgres with pgx

Start the database container:

```bash
make local-stack PROFILES=postgres
```

The cookiecutter `docker-compose.local.yml` exposes Postgres at `localhost:5433` under the `postgres` profile (see [Local Development](/howto/local-dev#databases) for the full port list).

### Add the config field

The cookiecutter ships a `config/` package that embeds the framework's `cbConfig.Config` and lets you add your own fields with `envconfig` tags. Add the database fields there so they're loaded, validated, and accessed the same way as the rest of your config:

```go
// config/config.go
type Config struct {
    cbConfig.Config
    auth.AuthConfig

    DatabaseURL     string `envconfig:"DATABASE_URL" required:"true"`
    DBPoolMaxConns  int32  `envconfig:"DB_POOL_MAX_CONNS" default:"20"`
    DBPoolMinConns  int32  `envconfig:"DB_POOL_MIN_CONNS" default:"2"`
}
```

Set the value the same way as any other env var:

```bash
export DATABASE_URL=postgres://postgres:postgres@localhost:5433/app?sslmode=disable
```

### Wire the pool

```go
package svc

import (
    "context"
    "fmt"

    "github.com/go-coldbrew/core"
    "github.com/go-coldbrew/tracing"
    "github.com/jackc/pgx/v5/pgxpool"

    "myapp/config" // import path of your service's config package
)

type Service struct {
    db *pgxpool.Pool
    // … your other fields
}

// Compile-time check: Service implements the lifecycle hooks.
var (
    _ core.CBPreStarter = (*Service)(nil)
    _ core.CBStopper    = (*Service)(nil)
)

func (s *Service) PreStart(ctx context.Context) error {
    cfg := config.Get()

    poolCfg, err := pgxpool.ParseConfig(cfg.DatabaseURL)
    if err != nil {
        return fmt.Errorf("parse DATABASE_URL: %w", err)
    }
    poolCfg.MaxConns = cfg.DBPoolMaxConns
    poolCfg.MinConns = cfg.DBPoolMinConns

    pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
    if err != nil {
        return fmt.Errorf("connect: %w", err)
    }
    if err := pool.Ping(ctx); err != nil {
        pool.Close()
        return fmt.Errorf("ping: %w", err)
    }
    s.db = pool
    return nil
}

func (s *Service) Stop() {
    if s.db != nil {
        s.db.Close()
    }
}
```

`PreStart` returning an error aborts startup *before* `/readycheck` ever turns green, so a database outage at boot is loud rather than silent. The corresponding `Stop()` runs after the gRPC server has finished its in-flight RPCs, so in-flight queries get their connections back to the pool before it shuts down.

### Trace every query

Use `tracing.NewDatastoreSpan` so each query becomes a child span of the calling gRPC span. The `datastore` and `operation` arguments become tags in the trace UI and `SetQuery` records the SQL itself:

```go
import (
    "context"

    "github.com/go-coldbrew/tracing"
    "github.com/jackc/pgx/v5"
)

func (s *Service) GetUser(ctx context.Context, id int64) (*User, error) {
    span, ctx := tracing.NewDatastoreSpan(ctx, "postgres", "SELECT", "users")
    defer span.End()
    span.SetQuery("SELECT id, email FROM users WHERE id = $1")

    row := s.db.QueryRow(ctx, "SELECT id, email FROM users WHERE id = $1", id)
    var u User
    if err := row.Scan(&u.ID, &u.Email); err != nil {
        if err == pgx.ErrNoRows {
            return nil, nil // not found
        }
        span.SetError(err)
        return nil, err
    }
    return &u, nil
}
```

The trace ID set by ColdBrew's interceptors is already in `ctx`, so the datastore span attaches to the right trace automatically. `span.SetError(err)` adds the error tag and the next interceptor up the chain will record it on the parent span as well.

### Transactions

Pass the same `ctx` through the whole transaction so all queries land on the same trace and the same context cancellation cancels the whole unit:

```go
func (s *Service) TransferFunds(ctx context.Context, from, to int64, cents int64) error {
    span, ctx := tracing.NewDatastoreSpan(ctx, "postgres", "TRANSACTION", "accounts")
    defer span.End()

    tx, err := s.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
    if err != nil {
        span.SetError(err)
        return err
    }
    defer tx.Rollback(ctx) // safe to call after Commit

    if _, err := tx.Exec(ctx, `UPDATE accounts SET balance = balance - $1 WHERE id = $2`, cents, from); err != nil {
        span.SetError(err)
        return err
    }
    if _, err := tx.Exec(ctx, `UPDATE accounts SET balance = balance + $1 WHERE id = $2`, cents, to); err != nil {
        span.SetError(err)
        return err
    }
    if err := tx.Commit(ctx); err != nil {
        span.SetError(err)
        return err
    }
    return nil
}
```

Keep transactions short — each one holds a connection from the pool for its full duration.

## Pool sizing

The right pool size depends on three numbers: how many concurrent RPCs your service handles, how long each query takes, and what the database can sustain.

A reasonable starting point:

- **MaxConns ≈ peak RPC concurrency × queries per RPC**, capped by what the database can serve. A 4-replica service with 100 RPC concurrency each and 1 query per RPC needs ~100 connections per replica — Postgres on commodity hardware tops out around 100–200 concurrent connections, so you may need a connection pooler (PgBouncer, RDS Proxy) in front.
- **MinConns ≥ 1** so the pool stays warm and the first request after an idle period doesn't pay the connect latency.
- **Watch `pgxpool.Stat()` (or your driver's equivalent)** — emit `acquired_conns / total_conns` as a Prometheus gauge. If it sits at 100% under load, you're queueing requests on the pool and `MaxConns` is too low.

Don't size the pool from a benchmark on an idle database — concurrency in production is bursty and your tail latency is what matters.

## Other databases

The pattern is identical for any other client. A few pointers:

- **MySQL** — use [go-sql-driver/mysql] with `database/sql`. `sql.Open` returns a pool; configure with `SetMaxOpenConns`, `SetMaxIdleConns`, `SetConnMaxLifetime`.
- **CockroachDB / AlloyDB** — both speak the Postgres wire protocol; the pgx example above works as-is.
- **MongoDB** — [mongo-go-driver]. The client *is* the pool; close it in `Stop()`.
- **Spanner** — [cloud.google.com/go/spanner]. The client manages sessions; close it in `Stop()`.
- **Object stores (S3, GCS)** — these are external services, not datastores; use `tracing.NewExternalSpan` instead.

For richer query-builder ergonomics on top of any of these, [`sqlc`](https://sqlc.dev/) generates type-safe Go from your SQL and works cleanly with the pattern above.

## Local stack profiles

The cookiecutter `docker-compose.local.yml` ships these database profiles. Start them with `make local-stack PROFILES=<profile>`:

| Profile | Service | Port |
|---|---|---|
| `postgres` | Postgres | 5433 |
| `mysql` | MySQL | 3306 |
| `cockroachdb` | CockroachDB | 26257 |
| `mongodb` | MongoDB | 27017 |
| `alloydb` | AlloyDB Omni | 5434 |
| `spanner` | Cloud Spanner emulator | 9010 |

See [Local Development](/howto/local-dev) for the full profile list.

## Related

- [Local Development](/howto/local-dev) — All local-stack profiles and how to combine them.
- [Tracing](/howto/Tracing) — How `NewDatastoreSpan` fits into the broader tracing model.
- [Shutdown Lifecycle](/howto/signals) — Full lifecycle interface table.
- [Production Deployment](/howto/production) — Resource limits, alerts, secrets handling.

[pgx]: https://github.com/jackc/pgx
[go-sql-driver/mysql]: https://github.com/go-sql-driver/mysql
[mongo-go-driver]: https://github.com/mongodb/mongo-go-driver
[cloud.google.com/go/spanner]: https://pkg.go.dev/cloud.google.com/go/spanner
