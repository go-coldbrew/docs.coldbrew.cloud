---
layout: default
title: "Local Development"
parent: "How To"
nav_order: 18
description: "Docker Compose local dev stack with per-service profiles for databases, caches, message brokers, AWS/GCP emulators, and observability"
---
## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

## Overview

Projects generated from the [ColdBrew cookiecutter] include a `docker-compose.local.yml` with 19 infrastructure services across 18 individual profiles plus one group profile (`obs` for Prometheus + Grafana + Jaeger). You select which profiles to start — only those containers run.

Your app runs natively via `make run` (fast builds, no Docker overhead). The compose stack provides only infrastructure dependencies.

## Quick Start

```bash
make local-stack                               # start default services (selected during generation)
make local-stack-obs                           # add Prometheus, Grafana, Jaeger
make run                                        # start the app
make loadtest                                   # generate traffic (ghz load test)
```

Open [http://localhost:3000](http://localhost:3000) (Grafana) and [http://localhost:16686](http://localhost:16686) (Jaeger) to see metrics and traces.

## Available Profiles

During project generation, you choose default services via the `local_services` prompt. Override anytime with `PROFILES=`:

```bash
make local-stack PROFILES="postgres kafka nats"
```

### Databases

| Profile | Image | Host Port | Notes |
|---------|-------|-----------|-------|
| `postgres` | `postgres:18-alpine` | 5433 | Health check: `pg_isready` |
| `mysql` | `mysql:8` | 3306 | Health check: `mysqladmin ping` |
| `cockroachdb` | `cockroachdb/cockroach` | 26257 | UI on 8081, single-node insecure |
| `mongodb` | `mongo:7` | 27017 | |
| `alloydb` | `google/alloydbomni` | 5434 | GCP PostgreSQL-compatible |

### Cache

| Profile | Image | Host Port | Notes |
|---------|-------|-----------|-------|
| `redis` | `redis:8-alpine` | 6379 | Health check: `redis-cli ping` |
| `valkey` | `valkey/valkey:8-alpine` | 6380 | Redis-compatible fork |
| `memcached` | `memcached:alpine` | 11211 | |

### Messaging

| Profile | Image | Host Port | Notes |
|---------|-------|-----------|-------|
| `kafka` | `apache/kafka` | 9092 | KRaft mode (no Zookeeper) |
| `nats` | `nats:alpine` | 4222 | JetStream enabled, monitoring on 8222 |

### Search

| Profile | Image | Host Port | Notes |
|---------|-------|-----------|-------|
| `elasticsearch` | `elasticsearch:8.17.0` | 9200 | Single-node, security disabled, health check |

### AWS Emulators

| Profile | Image | Host Port | Notes |
|---------|-------|-----------|-------|
| `ministack` | `nahuelnucera/ministack` | 4566 | Free LocalStack replacement (MIT), S3/SQS/SNS/DynamoDB |
| `dynamodb` | `amazon/dynamodb-local` | 8000 | DynamoDB only |

### GCP Emulators

| Profile | Image | Host Port | Notes |
|---------|-------|-----------|-------|
| `spanner` | `gcr.io/cloud-spanner-emulator/emulator` | 9010/9020 | gRPC + REST |
| `pubsub` | `google-cloud-cli:emulators` | 8085 | |
| `bigtable` | `google-cloud-cli:emulators` | 8086 | |
| `firestore` | `google-cloud-cli:emulators` | 8080 | |

### Tools

| Profile | Image | Host Port | Notes |
|---------|-------|-----------|-------|
| `adminer` | `adminer` | 8088 | SQL database admin UI |

### Observability (`obs`)

The `obs` profile starts all three observability services together:

| Service | Host Port | Notes |
|---------|-----------|-------|
| Prometheus | 9100 | Scrapes app on `host.docker.internal:9091` |
| Grafana | 3000 | Pre-built ColdBrew dashboard (admin/admin) |
| Jaeger | 16686 | OTLP receiver on 4317, traces flow automatically via `OTLP_ENDPOINT` in `local.env` |

## Makefile Targets

| Target | Description |
|--------|-------------|
| `make local-stack` | Start default profiles |
| `make local-stack-obs` | Start default profiles + observability |
| `make local-stack-down` | Stop all running containers |
| `make local-stack-logs` | Follow container logs |
| `make local-stack-reset` | Stop + restart |
| `make local-exec SVC=<name> CMD="..."` | Exec into any running service container |
| `make loadtest` | Run 10s gRPC load test with [ghz](https://ghz.sh) |

## Connecting Your App to Services

Your app runs on the host, not in Docker. Use `localhost:<host_port>` in your configuration:

```bash
# Example local.env for Postgres + Redis + OTLP tracing
ENVIRONMENT="dev"
DATABASE_URL=postgres://postgres:postgres@localhost:5433/myapp_dev?sslmode=disable
REDIS_URL=localhost:6379
OTLP_ENDPOINT=localhost:4317
OTLP_INSECURE=true
```

## Customizing the Stack

### Adding a new service

1. Add the service to `docker-compose.local.yml` with a profile:
   ```yaml
   myservice:
     image: myimage:latest
     profiles: ["myservice"]
     ports:
       - "8888:8888"
   ```
2. Run with `make local-stack PROFILES="postgres myservice"`

### Changing default profiles

Edit the `PROFILES` line in your Makefile:

```makefile
PROFILES ?= postgres redis kafka
```

Or override at runtime without editing the file:

```bash
make local-stack PROFILES="postgres mongodb nats"
```

### Disabling docker-compose entirely

During project generation, set `include_docker_compose` to `n`. The post-gen hook removes `docker-compose.local.yml` and `deploy/`. Makefile targets remain but will error with "no configuration file provided" if invoked — this is expected and serves as a clear signal to remove or ignore them.

## Grafana Dashboard

The `obs` profile auto-provisions a ColdBrew dashboard with:

- **Row 1 — RED Overview**: Request rate (QPS), error rate (%), latency p50/p95/p99
- **Row 2 — gRPC Details**: Status code distribution, p95 latency by method
- **Row 3 — Go Runtime**: Goroutines, heap usage, GC pause duration

The dashboard JSON is at `deploy/local/grafana/dashboards/coldbrew-service.json`. Edit it directly or modify through the Grafana UI (changes persist until `make local-stack-reset`).

## Troubleshooting

### Linux: Prometheus can't scrape the app

Prometheus runs in Docker and needs to reach the app on the host. The compose file includes `extra_hosts: host.docker.internal:host-gateway` which works on Docker Engine 20.10+. If scraping still fails, check `docker compose logs prometheus` for connection errors.

### Port conflicts

If a port is already in use, edit the host port mapping in `docker-compose.local.yml`:

```yaml
ports:
  - "5434:5432"  # change 5433 to 5434
```

### `make local-stack-down` doesn't stop containers

The down command uses `--profile "*"` to see all profiled services. If containers persist, use `docker compose -f docker-compose.local.yml --profile "*" down --remove-orphans`.

### Grafana shows "No data"

1. Verify Prometheus is scraping: open [http://localhost:9100/targets](http://localhost:9100/targets) — your app should show as UP
2. Verify the app is running (`make run`)
3. Generate traffic: `make loadtest` or `curl localhost:9091/api/v1/example/echo -d '{"msg":"hello"}'`

---
[ColdBrew cookiecutter]: /getting-started
