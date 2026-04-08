---
layout: default
title: "Metrics"
parent: "How To"
nav_order: 6
description: "Prometheus and OpenTelemetry metrics in ColdBrew: default runtime metrics, OTLP export, custom counters and histograms, and Hystrix circuit breaker monitoring"
---
## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

## How Metrics Work in ColdBrew

ColdBrew uses [Prometheus](https://prometheus.io/) to collect service metrics. By default, ColdBrew will expose a `/metrics` endpoint that will return the metrics in the [Prometheus exposition format](https://prometheus.io/docs/instrumenting/exposition_formats/) on the configured [HTTP port].

A collection of metrics are collected by default, including:
* Golang runtime metrics (e.g. memory usage, goroutine count, etc.)
* gRPC Client/Server metrics (e.g. request count, request duration, etc.)
* HTTP request metrics (e.g. request count, request duration, etc.)
* [Hystrix-go] circuit breaker metrics (e.g. request count, request duration, etc.) powered by [Hystrix Prometheus]

## Application Metrics Package (Cookiecutter)

Projects generated from the [ColdBrew cookiecutter] include a starter `service/metrics/` package with an interface-based pattern:

```text
service/metrics/
├── types.go       # Metrics interface (mockable via mockery)
├── metrics.go     # Implementation using promauto
├── labels.go      # Label constants (OutcomeSuccess, OutcomeError)
└── metrics_test.go
```

The interface enables dependency injection and test mocking. Sample metrics included:

| Metric | Type | Description |
|--------|------|-------------|
| `<app>_echo_total` | Counter | Echo RPC calls by outcome |
| `<app>_echo_duration_seconds` | Histogram | Echo RPC duration in seconds |
| `<app>_active_requests` | Gauge | Currently active requests |

Usage in handlers follows the defer pattern for automatic timing:

```go
func (s *svc) Echo(ctx context.Context, req *pb.EchoRequest) (resp *pb.EchoResponse, err error) {
    start := time.Now()
    outcome := metrics.OutcomeSuccess
    defer func() {
        if err != nil {
            outcome = metrics.OutcomeError
        }
        s.monitoring.IncEchoTotal(outcome)
        s.monitoring.ObserveEchoDuration(outcome, time.Since(start))
    }()
    // ... business logic ...
}
```

To add a new metric: add the method to the `Metrics` interface in `types.go`, implement it in `metrics.go`, run `make mock` to regenerate the mock.

{: .note }
Duration metrics use **seconds** (not milliseconds) following [Prometheus naming conventions](https://prometheus.io/docs/practices/naming/#base-units). Grafana handles unit display automatically.

## How to Add Custom Metrics

You can also add metrics directly using the [Prometheus Go client library] and registering them with the default Prometheus registry:

```go
package main

import (
    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promauto"
)

var (
    myCounter = promauto.NewCounter(prometheus.CounterOpts{
        Name: "my_counter",
        Help: "The total number of processed events",
    })
)

func myFunction() {
    ...
    myCounter.Inc()
    ...
}
```

These metrics will be automatically collected and exposed by ColdBrew on the `/metrics` endpoint.

{: .note .note-info }
To learn more about the Prometheus and the data types it supports, see [here](https://prometheus.io/docs/concepts/metric_types/)

## OpenTelemetry Metrics (OTLP Export)

In addition to Prometheus, ColdBrew can export gRPC metrics via OpenTelemetry's OTLP protocol. This is useful when your observability stack uses an OTLP-compatible backend (Grafana Cloud, Datadog, Honeycomb, etc.) and you want metrics alongside traces in the same pipeline.

{: .important }
OTEL metrics export is **opt-in** and runs **alongside** Prometheus — it does not replace the `/metrics` endpoint. Both can be active at the same time.

### Enabling OTEL Metrics

Set the following environment variables:

```bash
export ENABLE_OTEL_METRICS=true
export OTEL_METRICS_INTERVAL=60    # export interval in seconds (default: 60)
export OTLP_ENDPOINT=localhost:4317 # same endpoint used for traces
```

When enabled, ColdBrew exports standard [gRPC OpenTelemetry metrics](https://grpc.io/docs/guides/opentelemetry-metrics/) via the native `grpc/stats/opentelemetry` package:

| Metric | Type | Description |
|--------|------|-------------|
| `grpc.server.call.started` | Counter | Server RPCs started |
| `grpc.server.call.duration` | Histogram | Server RPC duration |
| `grpc.server.call.sent_total_compressed_message_size` | Histogram | Server response size |
| `grpc.server.call.rcvd_total_compressed_message_size` | Histogram | Server request size |
| `grpc.client.call.duration` | Histogram | Client RPC duration |
| `grpc.client.attempt.started` | Counter | Client RPC attempts |

{: .note }
Health check, readiness, and server reflection RPCs are bucketed under a generic `"other"` method label to reduce cardinality — they still generate data points but won't create high-cardinality method attributes.

### How it relates to Prometheus

| Aspect | Prometheus (`/metrics`) | OTEL Metrics (OTLP) |
|--------|------------------------|---------------------|
| Protocol | Pull (scrape) | Push (OTLP gRPC) |
| Metric names | `grpc_server_handled_total`, etc. | `grpc.server.call.duration`, etc. |
| Custom app metrics | `promauto.NewCounter(...)` | Not exported (Prometheus only) |
| Enabled by default | Yes | No (`ENABLE_OTEL_METRICS=true`) |
| Endpoint config | None (built-in) | `OTLP_ENDPOINT` (shared with traces) |

Both export pipelines use independent metric names and registries, so there is no conflict or double-counting.

## How to use Hystrix Metrics in Prometheus

{: .warning }
Hystrix-Go is unmaintained (last updated 2018). Consider migrating to [failsafe-go](https://github.com/failsafe-go/failsafe-go) for circuit breaker functionality.

[Hystrix Prometheus] is a library that provides a Prometheus metrics collector for [Hystrix-go]. To use it, you can register the collector with the default Prometheus registry:

```go

import (
    metricCollector "github.com/afex/hystrix-go/hystrix/metric_collector"
    "github.com/go-coldbrew/hystrixprometheus"
    "github.com/prometheus/client_golang/prometheus"
)

// setupHystrix sets up the hystrix metrics
// This is a workaround for hystrix-go not supporting the prometheus registry
func setupHystrix() {
	promC := hystrixprometheus.NewPrometheusCollector("hystrix", nil, prometheus.DefBuckets)
	metricCollector.Registry.Register(promC.Collector)
}
```

{: .note .note-info }
If you are using the `go-coldbrew/core` package, you can skip the above step as it will automatically register the collector for you.
See [Hystrix Prometheus] for more details.

---
[HTTP port]: https://pkg.go.dev/github.com/go-coldbrew/core/config#readme-type-config
[Hystrix Prometheus]: https://pkg.go.dev/github.com/go-coldbrew/hystrixprometheus
[Hystrix-go]: https://github.com/afex/hystrix-go
[Prometheus Go client library]: https://github.com/prometheus/client_golang
[ColdBrew cookiecutter]: /getting-started
