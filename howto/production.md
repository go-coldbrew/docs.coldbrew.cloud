---
layout: default
title: "Production Deployment"
parent: "How To"
nav_order: 13
description: "Deploy ColdBrew Go services to production with Kubernetes manifests, health probes, Prometheus, distributed tracing, and graceful shutdown"
---
## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

## Overview

This guide covers deploying ColdBrew services to production on Kubernetes. ColdBrew is designed for containerized environments — health checks, metrics, and graceful shutdown work out of the box.

## Docker image

The [ColdBrew cookiecutter] generates a multi-stage Dockerfile:

```dockerfile
# Build stage
FROM golang:1.25 AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /service .

# Runtime stage
FROM alpine:latest
RUN apk --no-cache add ca-certificates
COPY --from=builder /service /service
EXPOSE 9090 9091
ENTRYPOINT ["/service"]
```

Key points:
- `CGO_ENABLED=0` produces a static binary — no libc dependency
- `ca-certificates` is needed for TLS connections to external services (New Relic, Sentry, OTLP endpoints)
- Ports 9090 (gRPC) and 9091 (HTTP) are the defaults

Build and push:

```bash
docker build -t your-registry/myservice:v1.0.0 .
docker push your-registry/myservice:v1.0.0
```

## Kubernetes Deployment

### Basic Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myservice
  labels:
    app: myservice
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myservice
  template:
    metadata:
      labels:
        app: myservice
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "9091"
        prometheus.io/path: "/metrics"
    spec:
      terminationGracePeriodSeconds: 30
      containers:
        - name: myservice
          image: your-registry/myservice:v1.0.0
          ports:
            - name: grpc
              containerPort: 9090
              protocol: TCP
            - name: http
              containerPort: 9091
              protocol: TCP
          env:
            - name: APP_NAME
              value: myservice
            - name: ENVIRONMENT
              value: production
            - name: LOG_LEVEL
              value: info
          envFrom:
            - secretRef:
                name: myservice-secrets
          livenessProbe:
            httpGet:
              path: /healthcheck
              port: http
            initialDelaySeconds: 5
            periodSeconds: 10
            timeoutSeconds: 3
          readinessProbe:
            httpGet:
              path: /readycheck
              port: http
            initialDelaySeconds: 3
            periodSeconds: 5
            timeoutSeconds: 3
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: "1"
              memory: 512Mi
```

### Secrets

Store sensitive values like API keys in a Kubernetes Secret:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: myservice-secrets
type: Opaque
stringData:
  NEW_RELIC_LICENSE_KEY: "your-license-key"
  SENTRY_DSN: "https://your-dsn@sentry.io/123"
  OTLP_HEADERS: "x-honeycomb-team=your-api-key"  # if your OTLP backend needs auth
```

### Service

Expose both gRPC and HTTP ports:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: myservice
  labels:
    app: myservice
spec:
  selector:
    app: myservice
  ports:
    - name: grpc
      port: 9090
      targetPort: grpc
      protocol: TCP
    - name: http
      port: 9091
      targetPort: http
      protocol: TCP
```

## Health probes

ColdBrew provides two health endpoints:

| Endpoint | Purpose | Kubernetes probe |
|----------|---------|------------------|
| `/healthcheck` | Liveness — is the process alive? | `livenessProbe` |
| `/readycheck` | Readiness — can it accept traffic? | `readinessProbe` |

Both return JSON with build/version info on success. During graceful shutdown, `/readycheck` fails first, which causes Kubernetes to stop routing traffic before the process exits.

{: .important }
Set `terminationGracePeriodSeconds` to at least `SHUTDOWN_DURATION_IN_SECONDS` to avoid SIGKILL during shutdown. The drain wait (`GRPC_GRACEFUL_DURATION_IN_SECONDS`) is included within the shutdown timeout, not additional to it. With the default of 15s, a value of 20 provides a safe buffer.

## Graceful shutdown tuning

When pod termination begins, Kubernetes runs any configured `lifecycle.preStop` hook, then the kubelet sends `SIGTERM`. ColdBrew's in-process shutdown sequence then begins, bounded by `SHUTDOWN_DURATION_IN_SECONDS` (default 15s). Note: the `PreStop(ctx)` hook below refers to ColdBrew's [CBPreStopper] interface, not Kubernetes' `lifecycle.preStop`:

1. `PreStop(ctx)` on `CBPreStopper` services — deregister from service discovery, flush buffers
2. `FailCheck(true)` on `CBGracefulStopper` services — `/readycheck` starts failing
3. Wait `GRPC_GRACEFUL_DURATION_IN_SECONDS` (default: 7s, included in shutdown timeout) for the load balancer to drain
4. Cancel worker context, wait for workers to exit
5. Shutdown admin server if configured (`ADMIN_PORT`)
6. Shutdown HTTP server (stop accepting new requests)
7. `GracefulStop()` gRPC server (finish in-flight RPCs, reject new ones)
8. Force-stop gRPC server if graceful shutdown didn't complete in time
9. Call `Stop()` on `CBStopper` services — close database pools, flush metrics, drain message producers
10. `PostStop(ctx)` on `CBPostStopper` services — final cleanup, audit log close
11. Exit

See [Shutdown Lifecycle](/howto/signals) for the full interface table and [Readiness Patterns](/howto/readiness) for combining workers with health checks.

Tune these values based on your service:

```yaml
env:
  # If your longest request takes 30s, set shutdown duration accordingly
  - name: SHUTDOWN_DURATION_IN_SECONDS
    value: "35"
  # Match your load balancer's health check interval + propagation time
  - name: GRPC_GRACEFUL_DURATION_IN_SECONDS
    value: "10"
```

For more details, see [Signal Handling and Graceful Shutdown](/howto/signals).

## Prometheus monitoring

### Prometheus ServiceMonitor

If you're using the [Prometheus Operator](https://prometheus-operator.dev/):

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: myservice
  labels:
    app: myservice
spec:
  selector:
    matchLabels:
      app: myservice
  endpoints:
    - port: http
      path: /metrics
      interval: 15s
```

### Key metrics to alert on

ColdBrew exposes these metrics out of the box via gRPC interceptors:

| Metric | Type | Description |
|--------|------|-------------|
| `grpc_server_handled_total` | Counter | Total RPCs completed, by method and status code |
| `grpc_server_handling_seconds` | Histogram | RPC latency distribution. **Only available when `ENABLE_PROMETHEUS_GRPC_HISTOGRAM=true`** (the default). Disabling this removes all latency percentile data from Prometheus |
| `grpc_server_started_total` | Counter | Total RPCs started |

Recommended alerts:

```yaml
# High error rate
- alert: HighGRPCErrorRate
  expr: |
    sum(rate(grpc_server_handled_total{grpc_code!="OK"}[5m])) by (grpc_service)
    /
    sum(rate(grpc_server_handled_total[5m])) by (grpc_service)
    > 0.05
  for: 5m

# High latency (p99 > 1s)
- alert: HighGRPCLatency
  expr: |
    histogram_quantile(0.99,
      sum(rate(grpc_server_handling_seconds_bucket[5m])) by (le, grpc_service)
    ) > 1
  for: 5m
```

{: .warning }
The latency alert above requires `ENABLE_PROMETHEUS_GRPC_HISTOGRAM=true` (the default). If you set it to `false` for [throughput tuning](/config-reference#measured-tuning-impact), the `grpc_server_handling_seconds` metric disappears and this alert will silently stop firing. Ensure you have an alternative latency signal (distributed tracing, load balancer metrics) before disabling histograms.

### Custom histogram buckets

If the default latency buckets don't match your SLOs, customize them:

```yaml
env:
  - name: PROMETHEUS_GRPC_HISTOGRAM_BUCKETS
    value: "0.005,0.01,0.025,0.05,0.1,0.25,0.5,1,2.5,5,10"
```

## Distributed tracing

ColdBrew sends traces via OpenTelemetry to any OTLP-compatible backend (Jaeger, Grafana Tempo, Honeycomb, Datadog, etc.) or New Relic.

### OTLP backend (Jaeger, Tempo, Honeycomb, etc.)

```yaml
env:
  - name: OTLP_ENDPOINT
    value: "otel-collector.monitoring:4317"  # your OTLP collector
  - name: OTLP_SAMPLING_RATIO
    value: "0.1"  # sample 10% of traces in production
```

For backends that require authentication headers:

```yaml
env:
  - name: OTLP_ENDPOINT
    value: "api.honeycomb.io:443"
  - name: OTLP_HEADERS
    value: "x-honeycomb-team=your-api-key"
  - name: OTLP_SAMPLING_RATIO
    value: "0.1"
```

{: .note }
For local development, set `OTLP_INSECURE=true` and point to a local Jaeger instance (`localhost:4317`). See the [config reference](/config-reference#example-local-development-with-jaeger-via-otlp) for a full example.

### New Relic

New Relic tracing is configured separately and can run alongside OTLP:

```yaml
env:
  - name: NEW_RELIC_LICENSE_KEY
    valueFrom:
      secretKeyRef:
        name: myservice-secrets
        key: NEW_RELIC_LICENSE_KEY
  - name: NEW_RELIC_OPENTELEMETRY
    value: "true"
  - name: NEW_RELIC_OPENTELEMETRY_SAMPLE
    value: "0.2"
```

### OTEL metrics (alongside Prometheus)

To export gRPC metrics via OTLP alongside Prometheus scraping, enable OTEL metrics on the same endpoint used for tracing:

```yaml
env:
  - name: ENABLE_OTEL_METRICS
    value: "true"
  - name: OTEL_METRICS_INTERVAL
    value: "60"  # seconds between OTLP metric exports
  # OTLP_ENDPOINT is already set for tracing above
```

{: .note }
This does not replace Prometheus — both `/metrics` scraping and OTLP push run in parallel. See the [Metrics How-To](/howto/Metrics/#opentelemetry-metrics-otlp-export) for details on exported metric names.

### What gets traced

ColdBrew automatically creates spans for:

| Source | Span kind | Example |
|--------|-----------|---------|
| Incoming gRPC RPCs | Server | `/pkg.Service/Method` |
| Incoming HTTP requests | Server | `ServeHTTP` |
| Outbound gRPC calls (gateway) | Client | `/pkg.Service/Method` |
| `tracing.NewInternalSpan()` | Internal | Custom business logic spans |
| `tracing.NewDatastoreSpan()` | Client | Database/Redis operations |
| `tracing.NewExternalSpan()` | Client | External HTTP/API calls |

### Sampling in production

Set `OTLP_SAMPLING_RATIO` based on your traffic volume:

| QPS | Recommended ratio | Traces/sec |
|-----|-------------------|------------|
| 100 | `1.0` | 100 |
| 1,000 | `0.1` | 100 |
| 10,000 | `0.01` | 100 |
| 70,000+ | `0.001–0.01` | 70–700 |

{: .important }
Sampling is parent-based — if an incoming request already has a sampled trace context, ColdBrew respects that decision regardless of the local ratio.

## gRPC load balancing

gRPC uses HTTP/2 with long-lived connections. A standard Kubernetes Service with `ClusterIP` won't distribute load across pods — all requests go over a single connection to one pod.

Solutions:

### Option 1: Headless Service + client-side balancing

```yaml
apiVersion: v1
kind: Service
metadata:
  name: myservice-headless
spec:
  clusterIP: None  # headless
  selector:
    app: myservice
  ports:
    - name: grpc
      port: 9090
```

Use with ColdBrew's [grpcpool](https://pkg.go.dev/github.com/go-coldbrew/grpcpool) for client-side round-robin:

```go
conn, err := grpcpool.DialContext(ctx, "dns:///myservice-headless:9090",
    grpc.WithDefaultServiceConfig(`{"loadBalancingPolicy":"round_robin"}`),
)
```

### Option 2: Service mesh / L7 proxy

Use a gRPC-aware proxy (Istio, Linkerd, Envoy) that understands HTTP/2 multiplexing and balances per-request rather than per-connection.

## TLS

Enable TLS on the gRPC server:

```yaml
env:
  - name: GRPC_TLS_CERT_FILE
    value: /certs/tls.crt
  - name: GRPC_TLS_KEY_FILE
    value: /certs/tls.key
volumeMounts:
  - name: tls-certs
    mountPath: /certs
    readOnly: true
volumes:
  - name: tls-certs
    secret:
      secretName: myservice-tls
```

ColdBrew automatically watches the certificate and key files for changes and reloads them without requiring a restart. This works with cert-manager, Vault Agent, and any other tool that rotates certificates via file or symlink updates.

{: .note }
If you're using a service mesh that handles mTLS (Istio, Linkerd), you typically don't need ColdBrew's built-in TLS — the mesh sidecar terminates TLS at the pod level.

## Resource tuning

### GOMAXPROCS

ColdBrew automatically sets `GOMAXPROCS` to match the container's CPU limit using [automaxprocs](https://github.com/uber-go/automaxprocs). This prevents the Go runtime from spawning more OS threads than the container has CPU quota.

If your container runtime already handles this (e.g., via `cgroup`-aware runtimes), disable it:

```yaml
env:
  - name: DISABLE_AUTO_MAX_PROCS
    value: "true"
```

### Connection keepalive

ColdBrew ships sane defaults for connection keepalive (idle: 300s, age: 1800s, grace: 30s). These ensure connections rotate for balanced load distribution and timely DNS updates. Override only if your service has specific requirements:

```yaml
env:
  # Override: close idle connections after 10 minutes instead of 5
  - name: GRPC_SERVER_MAX_CONNECTION_IDLE_IN_SECONDS
    value: "600"
  # Override: force connection refresh every hour instead of 30 minutes
  # Change to "-1" to disable the connection age limit entirely (not recommended)
  - name: GRPC_SERVER_MAX_CONNECTION_AGE_IN_SECONDS
    value: "3600"
```

## Security hardening

{: .warning }
This section provides general security guidance for ColdBrew configuration. Always follow your organization's security policies and compliance requirements. ColdBrew is a framework — securing your deployment is your responsibility.

ColdBrew's defaults are tuned for **internal services** — debug endpoints, API docs, and gRPC reflection are enabled by default. Public-facing services need different settings.

### Dedicated admin port (recommended)

The **preferred approach** is to serve admin endpoints (pprof, metrics, swagger) on a **separate port** using `ADMIN_PORT`. This keeps profiling and metrics available for operations while isolating them from external traffic via Kubernetes NetworkPolicy:

```yaml
env:
  # Serve admin endpoints on a dedicated internal port
  - name: ADMIN_PORT
    value: "9092"
```

When `ADMIN_PORT` is set:
- **Port 9090** (gRPC): gRPC server — expose as needed
- **Port 9091** (HTTP): gRPC-gateway + health/readiness probes — expose with path allowlisting
- **Admin port** (e.g., 9092): pprof, metrics, swagger — restrict via NetworkPolicy

```yaml
# Kubernetes NetworkPolicy — restricts admin port (9092) to monitoring namespace
# while leaving app ports (9090/9091) open. Add further restrictions to
# 9090/9091 if you need to limit app traffic sources too.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: restrict-admin-port
spec:
  podSelector:
    matchLabels:
      app: my-service
  policyTypes:
    - Ingress
  ingress:
    # Allow app traffic (gRPC + HTTP gateway) from anywhere
    - ports:
        - port: 9090
        - port: 9091
    # Restrict admin port to monitoring namespace only
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: monitoring
      ports:
        - port: 9092
```

This approach is better than disabling endpoints entirely because:
- Prometheus can still scrape `/metrics` on the admin port
- Operations can still access pprof for production debugging
- No application-level auth needed — network isolation handles it

### Public-facing services

For services exposed to external traffic where a separate admin port is not sufficient, disable discovery and debug features entirely:

{: .important }
The most effective security measure is to **use `ADMIN_PORT`** to separate admin endpoints, or **whitelist public API paths** at your load balancer and block everything else. ColdBrew serves the HTTP gateway on the HTTP port (default 9091) and gRPC on a separate port (default 9090). When `ADMIN_PORT` is not set, admin endpoints (debug, metrics, swagger) share the HTTP port. Only your application's API routes (e.g., `/api/v1/*`) should be exposed externally.

```yaml
env:
  # Option 1 (preferred): Separate admin port
  - name: ADMIN_PORT
    value: "9092"
  # Option 2: Disable admin endpoints entirely
  # Disable pprof — exposes CPU/memory profiling data
  - name: DISABLE_DEBUG
    value: "true"
  # Disable Swagger UI — exposes API schema and endpoint discovery
  - name: DISABLE_SWAGGER
    value: "true"
  # Disable gRPC reflection — prevents service discovery via grpcurl
  - name: DISABLE_GRPC_REFLECTION
    value: "true"
  # Disable debug log interceptor — prevents external clients from
  # triggering debug logging via x-debug-log-level header
  - name: DISABLE_DEBUG_LOG_INTERCEPTOR
    value: "true"
  # Never use debug level on public services — may log request payloads
  - name: LOG_LEVEL
    value: "info"
  # Rate limit incoming requests (per-pod). Adjust to your service's capacity.
  - name: RATE_LIMIT_PER_SECOND
    value: "1000"
  - name: RATE_LIMIT_BURST
    value: "50"
  # GRPC_MAX_SEND_MSG_SIZE limits response size FROM your service (default ~2GB).
  # GRPC_MAX_RECV_MSG_SIZE limits request size TO your service (default 4MB).
  # Consider reducing send size for public APIs; use streaming for large payloads.
  # - name: GRPC_MAX_SEND_MSG_SIZE
  #   value: "16777216"  # 16MB
```

{: .important }
The `/metrics` endpoint exposes request counts, latency distributions, and Go runtime stats. When using `ADMIN_PORT`, metrics are automatically served on the admin port only. Without `ADMIN_PORT`, restrict access to `/metrics` at the load balancer level (IP whitelist or path-based routing) rather than disabling Prometheus entirely.

### Internal services

Services behind a load balancer or service mesh can keep the defaults:

- **Debug endpoints** (`/debug/pprof/`) — useful for profiling production issues
- **Swagger UI** (`/swagger/`) — API documentation for developers
- **gRPC reflection** — enables `grpcurl` and `grpcui` for ad-hoc testing
- **Debug log interceptor** — `OverrideLogLevel` + trace ID for targeted production debugging (see [Log How-To](/howto/Log/#production-debugging-with-overrideloglevel--trace-id))
- **Default message sizes** — ~2GB send (response) / 4MB recv (request) defaults are fine behind a load balancer

{: .note }
Internal services should still follow the production checklist below for observability, health probes, and graceful shutdown.

### Built-in protections

ColdBrew includes several security features that are **on by default**. Don't disable them unless you have a specific reason:

| Protection | What it does | Config to disable (not recommended) |
|-----------|-------------|--------------------------------------|
| **Trace ID validation** | Sanitizes client-supplied trace IDs — max 128 chars, printable ASCII only. Prevents log injection attacks | `SetTraceIDValidator(nil)` in code |
| **Protovalidate** | Validates incoming messages against proto annotation rules. Returns `InvalidArgument` on failure | `DISABLE_PROTO_VALIDATE=true` |
| **Default timeout** | 60s deadline on unary RPCs without one. Prevents slowloris and resource exhaustion | `GRPC_SERVER_DEFAULT_TIMEOUT_IN_SECONDS=0` |
| **Panic recovery** | Catches handler panics, returns generic error to client. Stack traces go to logs and error trackers only — never in gRPC responses | Cannot be disabled |

### Data sent to third-party services

{: .important }
When error tracking (Sentry, Rollbar) or distributed tracing (New Relic, OTLP) is configured, ColdBrew sends data to external services. Review what your service logs before enabling these on public-facing services.

**What gets sent to error trackers (Sentry, Rollbar, Airbrake):**
- Stack traces with internal file paths and function names
- Server hostname and git commit hash
- Log context fields — any data added via `log.AddToContext()` or `log.AddAttrsToContext()` is included
- Trace IDs and OTEL span context

**What gets sent to tracing backends (New Relic, OTLP):**
- Service name, version, environment
- Go runtime version and VCS metadata
- Span attributes including `coldbrew.trace_id`

Avoid adding PII (passwords, tokens, user data) to log context or error notification tags.

### Not built into ColdBrew

These are your responsibility to handle at the infrastructure level:

- **CORS** — ColdBrew does not handle CORS headers. Use a reverse proxy (Nginx, Envoy, Istio) or add CORS middleware to the HTTP gateway.
- **Authentication/authorization** — Admin endpoints (`/debug/pprof`, `/metrics`, `/swagger`) have no built-in auth. Disable them for public services or restrict access at the load balancer. For application-level auth (JWT, API keys), the [cookiecutter template][ColdBrew cookiecutter] includes ready-to-use examples — see [Authentication How-To](/howto/auth/).
- **Cluster-wide rate limiting** — Built-in rate limiting (`RATE_LIMIT_PER_SECOND`) is per-pod only. For cluster-wide or per-tenant rate limiting, use `interceptors.SetRateLimiter()` with a custom implementation or your load balancer. See [Interceptors How-To](/howto/interceptors#rate-limiting).
- **HTTP header forwarding** — `HTTP_HEADER_PREFIXES` forwards matching HTTP headers to gRPC metadata. Never add `authorization`, `cookie`, or `x-api-key` prefixes unless you are intentionally doing header-based gRPC auth.

## Production checklist

### All services

- [ ] Set `APP_NAME` and `ENVIRONMENT` for log/metric identification
- [ ] Configure `livenessProbe` on `/healthcheck` and `readinessProbe` on `/readycheck`
- [ ] Set `terminationGracePeriodSeconds` ≥ shutdown + healthcheck wait duration
- [ ] Enable Prometheus scraping (annotation or ServiceMonitor)
- [ ] Set up error tracking (`SENTRY_DSN` or equivalent)
- [ ] Configure tracing (`OTLP_ENDPOINT` or `NEW_RELIC_LICENSE_KEY`)
- [ ] Use headless Service or L7 proxy for gRPC load balancing
- [ ] Set resource requests and limits
- [ ] Store secrets in Kubernetes Secrets, not environment variable literals
- [ ] Run `make lint` (includes `govulncheck`) before deploying
- [ ] For high-QPS services: set `RESPONSE_TIME_LOG_ERROR_ONLY=true` to skip per-request logging on successful RPCs (see [tuning impact](/config-reference#measured-tuning-impact))

### Public-facing services (additional)

- [ ] **Whitelist public API paths** at the load balancer — block `/debug/*`, `/metrics`, `/swagger/*`
- [ ] `DISABLE_DEBUG=true` — disable pprof endpoints
- [ ] `DISABLE_SWAGGER=true` — disable API documentation
- [ ] `DISABLE_GRPC_REFLECTION=true` — disable service discovery
- [ ] `DISABLE_DEBUG_LOG_INTERCEPTOR=true` — disable header-based debug logging
- [ ] Enable rate limiting — `RATE_LIMIT_PER_SECOND` + `RATE_LIMIT_BURST` (per-pod, adjust to capacity). See [interceptors howto](/howto/interceptors#rate-limiting)
- [ ] Consider reducing `GRPC_MAX_SEND_MSG_SIZE` from its ~2GB default if responses are small
- [ ] Restrict `/metrics` access at the load balancer
- [ ] `LOG_LEVEL=info` or higher (never `debug`)

---

## Related

- [Readiness Patterns](/howto/readiness) — health check strategies with workers
- [Interceptors](/howto/interceptors) — rate limiting, timeout, and custom middleware
- [Shutdown Lifecycle](/howto/signals) — SIGTERM, drain period, FailCheck sequence
- [Workers](/howto/workers) — background goroutine management with restart and metrics

[ColdBrew cookiecutter]: /getting-started
[CBPreStopper]: https://pkg.go.dev/github.com/go-coldbrew/core#CBPreStopper
