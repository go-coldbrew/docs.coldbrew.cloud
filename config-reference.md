---
layout: default
title: "Configuration Reference"
nav_order: 5
description: "Complete environment variable reference for ColdBrew Go microservice framework configuration"
permalink: /config-reference
---
# Configuration Reference
{: .no_toc }

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

ColdBrew is configured entirely through environment variables using [envconfig](https://github.com/kelseyhightower/envconfig). All fields have sensible defaults — you can run a service with zero configuration.

Access the config in code via:

```go
cfg := config.GetColdBrewConfig()
```

## Server

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `LISTEN_HOST` | string | `0.0.0.0` | Host address to listen on |
| `GRPC_PORT` | int | `9090` | gRPC server port |
| `HTTP_PORT` | int | `9091` | HTTP gateway port |
| `APP_NAME` | string | `""` | Application name (used in logs, metrics, New Relic) |
| `ENVIRONMENT` | string | `""` | Environment name (e.g., production, staging, development) |
| `RELEASE_NAME` | string | `""` | Release/version name |

## Logging

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `LOG_LEVEL` | string | `info` | Log level: debug, info, warn, error |
| `JSON_LOGS` | bool | `true` | Emit logs in JSON format |

## gRPC Server

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `DISABLE_GRPC_REFLECTION` | bool | `false` | Disable gRPC server reflection (used by tools like grpcurl) |
| `DO_NOT_LOG_GRPC_REFLECTION` | bool | `true` | Suppress logging of gRPC reflection API calls |
| `GRPC_MAX_SEND_MSG_SIZE` | int | `2147483647` | Maximum send message size in bytes (default: ~2GB, unlimited) |
| `GRPC_MAX_RECV_MSG_SIZE` | int | `4194304` | Maximum receive message size in bytes (default: 4MB) |
| `DISABLE_VT_PROTOBUF` | bool | `false` | Disable [vtprotobuf](https://github.com/planetscale/vtprotobuf) marshaller for gRPC. See [vtprotobuf guide](/howto/vtproto) |

## gRPC TLS

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `GRPC_TLS_KEY_FILE` | string | `""` | Path to TLS private key file. Both key and cert must be set to enable TLS |
| `GRPC_TLS_CERT_FILE` | string | `""` | Path to TLS certificate file. Both key and cert must be set to enable TLS |
| `GRPC_TLS_INSECURE_SKIP_VERIFY` | bool | `false` | Skip TLS certificate verification (development only) |

## gRPC Keepalive

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `GRPC_SERVER_MAX_CONNECTION_IDLE_IN_SECONDS` | int | `0` | Close idle connections after this duration (0 = disabled) |
| `GRPC_SERVER_MAX_CONNECTION_AGE_IN_SECONDS` | int | `0` | Maximum connection lifetime with ±10% jitter (0 = disabled) |
| `GRPC_SERVER_MAX_CONNECTION_AGE_GRACE_IN_SECONDS` | int | `0` | Grace period after max connection age before force-closing |

## HTTP Gateway

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `DISABLE_SWAGGER` | bool | `false` | Disable Swagger UI at the swagger URL |
| `SWAGGER_URL` | string | `/swagger/` | URL path for Swagger UI |
| `DISABLE_DEBUG` | bool | `false` | Disable pprof debug endpoints at `/debug/` |
| `USE_JSON_BUILTIN_MARSHALLER` | bool | `false` | Use `encoding/json` instead of the default protojson marshaller for `application/json` |
| `JSON_BUILTIN_MARSHALLER_MIME` | string | `application/json` | Content-Type for the JSON builtin marshaller |
| `HTTP_HEADER_PREFIXES` | []string | `""` | HTTP header prefixes to forward as gRPC metadata (comma-separated) |
| `TRACE_HEADER_NAME` | string | `x-trace-id` | HTTP header name for trace ID propagation to log/trace contexts |
| `DISABLE_HTTP_COMPRESSION` | bool | `false` | Disable gzip/zstd compression for HTTP gateway responses |
| `HTTP_COMPRESSION_MIN_SIZE` | int | `256` | Minimum response body size (bytes) before compression is applied. Responses smaller than this are sent uncompressed |

## Prometheus Metrics

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `DISABLE_PROMETHEUS` | bool | `false` | Disable Prometheus metrics endpoint at `/metrics` |
| `ENABLE_PROMETHEUS_GRPC_HISTOGRAM` | bool | `true` | Enable gRPC request latency histograms |
| `PROMETHEUS_GRPC_HISTOGRAM_BUCKETS` | []float64 | `""` | Custom histogram buckets (comma-separated seconds, e.g., `0.005,0.01,0.025,0.05,0.1,0.25,0.5,1,2.5,5,10`) |

## New Relic

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `NEW_RELIC_LICENSE_KEY` | string | `""` | New Relic license key (required to enable New Relic) |
| `NEW_RELIC_APPNAME` | string | `""` | Application name in New Relic |
| `DISABLE_NEW_RELIC` | bool | `false` | Disable all New Relic reporting. **Note:** automatically set to `true` at startup when `NEW_RELIC_LICENSE_KEY` is empty, so the effective default for services without a license key is `true` |
| `NEW_RELIC_DISTRIBUTED_TRACING` | bool | `true` | Enable New Relic distributed tracing |
| `NEW_RELIC_OPENTELEMETRY` | bool | `true` | Enable New Relic via OpenTelemetry |
| `NEW_RELIC_OPENTELEMETRY_SAMPLE` | float64 | `0.1` | Trace sampling ratio for New Relic OpenTelemetry (0.0–1.0) |

## OpenTelemetry (OTLP)

{: .note }
When `OTLP_ENDPOINT` is set, it takes precedence over New Relic OpenTelemetry configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `OTLP_ENDPOINT` | string | `""` | OTLP gRPC endpoint (e.g., `localhost:4317`, `api.honeycomb.io:443`) |
| `OTLP_HEADERS` | string | `""` | Custom headers as `key=value` pairs (comma-separated, e.g., `x-honeycomb-team=your-key`) |
| `OTLP_COMPRESSION` | string | `gzip` | Compression type: `gzip` or `none` |
| `OTLP_INSECURE` | bool | `false` | Disable TLS for OTLP connection (development only) |
| `OTLP_SAMPLING_RATIO` | float64 | `0.1` | Trace sampling ratio (0.0–1.0, where 1.0 = sample all) |
| `OTLP_USE_OPENTRACING_BRIDGE` | bool | `false` | **Deprecated.** Enable legacy OpenTracing bridge — only needed for services with unmigrated OpenTracing instrumentation |

## Error Tracking

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `SENTRY_DSN` | string | `""` | Sentry DSN for error notification |

## Graceful Shutdown

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `DISABLE_SIGNAL_HANDLER` | bool | `false` | Disable ColdBrew's SIGINT/SIGTERM handler |
| `SHUTDOWN_DURATION_IN_SECONDS` | int | `15` | Time to wait for in-flight requests to complete before forced shutdown |
| `GRPC_GRACEFUL_DURATION_IN_SECONDS` | int | `7` | Time to wait for healthcheck failure to propagate before initiating shutdown. Should be less than `SHUTDOWN_DURATION_IN_SECONDS` |

## Response Time Logging

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `RESPONSE_TIME_LOG_LEVEL` | string | `info` | Log level for per-request response time logging. Valid: `debug`, `info`, `warn`, `error`. Invalid values fall back to `info`. Must be >= `LOG_LEVEL` to take effect |
| `RESPONSE_TIME_LOG_ERROR_ONLY` | bool | `false` | When `true`, only log response time for requests that return an error. Successful requests are not logged. Note: if `LOG_LEVEL` is set higher than `RESPONSE_TIME_LOG_LEVEL`, response time logs are already suppressed |

## Runtime

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `DISABLE_AUTO_MAX_PROCS` | bool | `false` | Disable automatic GOMAXPROCS tuning (useful if your container runtime already sets it) |

## Deprecated

| Variable | Replacement | Notes |
|----------|------------|-------|
| `HTTP_HEADER_PREFIX` | `HTTP_HEADER_PREFIXES` | Single prefix replaced by comma-separated list |
| `DISABLE_PORMETHEUS` | `DISABLE_PROMETHEUS` | Typo variant — both work, use the correct spelling |
| `OTLP_USE_OPENTRACING_BRIDGE` | Remove | Legacy OpenTracing bridge — remove once all instrumentation uses OpenTelemetry |
| `GRPCClientInterceptor()` | Remove call | No-op since interceptors v0.1.15 — safe to delete |

---

## Example: Minimal Production Configuration

```bash
export APP_NAME=myservice
export ENVIRONMENT=production
export LOG_LEVEL=info
export NEW_RELIC_LICENSE_KEY=your-key
export NEW_RELIC_APPNAME=myservice
export SENTRY_DSN=https://your-dsn@sentry.io/123
```

## Example: Local Development with Jaeger (via OTLP)

```bash
export APP_NAME=myservice
export ENVIRONMENT=development
export LOG_LEVEL=debug
export OTLP_ENDPOINT=localhost:4317
export OTLP_INSECURE=true
export OTLP_SAMPLING_RATIO=1.0
export DISABLE_NEW_RELIC=true
```

## Example: High-Throughput Production

For services at 70k+ QPS where observability overhead matters:

```bash
export APP_NAME=myservice
export ENVIRONMENT=production
export LOG_LEVEL=warn                       # suppresses info-level response time logs
# export OTLP_ENDPOINT=your-collector:4317  # uncomment if using OTLP tracing
export OTLP_SAMPLING_RATIO=0.05              # only applies when OTLP_ENDPOINT is set
export ENABLE_PROMETHEUS_GRPC_HISTOGRAM=false
export DISABLE_NEW_RELIC=true
export HTTP_COMPRESSION_MIN_SIZE=512
```

---

Source: [`core/config/config.go`](https://github.com/go-coldbrew/core/blob/main/config/config.go)
