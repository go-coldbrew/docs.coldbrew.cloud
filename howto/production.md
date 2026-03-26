---
layout: default
title: "Production Deployment"
parent: "How To"
description: "Deploy ColdBrew Go services to production with Kubernetes manifests, health probes, Prometheus, and graceful shutdown"
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
Set `terminationGracePeriodSeconds` to at least `SHUTDOWN_DURATION_IN_SECONDS` + `GRPC_GRACEFUL_DURATION_IN_SECONDS` to avoid SIGKILL during shutdown. With defaults (15 + 7 = 22), a value of 30 provides a safe buffer.

## Graceful shutdown tuning

ColdBrew's shutdown sequence:

1. Receive SIGTERM from Kubernetes
2. Fail `/readycheck` immediately
3. Wait `GRPC_GRACEFUL_DURATION_IN_SECONDS` (default: 7s) for the load balancer to drain
4. Stop accepting new requests
5. Wait `SHUTDOWN_DURATION_IN_SECONDS` (default: 15s) for in-flight requests to complete
6. Call `Stop()` if your service implements `CBStopper`
7. Exit

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
| `grpc_server_handling_seconds` | Histogram | RPC latency distribution (if `ENABLE_PROMETHEUS_GRPC_HISTOGRAM=true`) |
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

### Custom histogram buckets

If the default latency buckets don't match your SLOs, customize them:

```yaml
env:
  - name: PROMETHEUS_GRPC_HISTOGRAM_BUCKETS
    value: "0.005,0.01,0.025,0.05,0.1,0.25,0.5,1,2.5,5,10"
```

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

For services behind load balancers with idle connection timeouts, configure keepalive:

```yaml
env:
  # Close connections idle for more than 5 minutes
  - name: GRPC_SERVER_MAX_CONNECTION_IDLE_IN_SECONDS
    value: "300"
  # Force connection refresh every 30 minutes (with ±10% jitter)
  - name: GRPC_SERVER_MAX_CONNECTION_AGE_IN_SECONDS
    value: "1800"
  # Allow 30s grace period for in-flight RPCs on aged connections
  - name: GRPC_SERVER_MAX_CONNECTION_AGE_GRACE_IN_SECONDS
    value: "30"
```

## Production checklist

- [ ] Set `APP_NAME` and `ENVIRONMENT` for log/metric identification
- [ ] Configure `livenessProbe` on `/healthcheck` and `readinessProbe` on `/readycheck`
- [ ] Set `terminationGracePeriodSeconds` ≥ shutdown + healthcheck wait duration
- [ ] Enable Prometheus scraping (annotation or ServiceMonitor)
- [ ] Set up error tracking (`SENTRY_DSN` or equivalent)
- [ ] Configure tracing (`OTLP_ENDPOINT` or `NEW_RELIC_LICENSE_KEY`)
- [ ] Use headless Service or L7 proxy for gRPC load balancing
- [ ] Set resource requests and limits
- [ ] Store secrets in Kubernetes Secrets, not environment variable literals
- [ ] Disable debug endpoints in production if not needed (`DISABLE_DEBUG=true`)
- [ ] Run `make lint` (includes `govulncheck`) before deploying

---
[ColdBrew cookiecutter]: /getting-started
