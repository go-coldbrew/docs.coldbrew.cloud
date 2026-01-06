---
layout: default
title: Integrations
permalink: /integrations
description: coldbrew integrations with other services and tools
nav_order: 3
---
# Integrations
{: .no_toc }
Coldbrew is designed to be very thin wrappers over other services and tools. This page lists the services and tools that Coldbrew integrates with.

These integrations are optional and you can choose to use them or not. You can also choose to use other services and tools instead of the ones listed here. Coldbrew is designed to be flexible and easy to integrate with other services and tools.

If you want to integrate Coldbrew with a service or tool that is not listed here, please [open an issue].

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

## GRPC Gateway

Coldbrew relies on [GRPC Gateway] to expose the gRPC API as a REST API. The gateway is a proxy that translates a RESTful HTTP API into gRPC. It's a great tool to expose gRPC services to the web and mobile clients.

To see how it works in Coldbrew, check out the [gRPC Gateway example].

## New Relic

[New Relic] is a SaaS-based monitoring tool that helps to monitor the performance of the services. It collects data about the services and displays it in a dashboard. It also provides alerts when the service is not performing well.

### Configuring

To configure New Relic, set the following environment variables as defined in [Config]
- `NEW_RELIC_APPNAME`: New Relic app name (e.g. `my-app`)
- `NEW_RELIC_LICENSE_KEY`: New Relic license key
- `NEW_RELIC_OPENTELEMETRY`: Set to `true` to use New Relic [Opentelemetry] interface
- `NEW_RELIC_DISTRIBUTED_TRACING`: Set to `true` to enable distributed tracing
- `NEW_RELIC_OPENTELEMETRY_SAMPLE`: Set to float value between `0` and `1` to set the sampling rate for distributed tracing

### Initialising

If you app is using [Coldbrew cookiecutter] template, initialisation is done automatically.

If you are using Coldbrew packages in your app, you need to initialise New Relic manually. To initialise New Relic use the [SetupNewRelic] function and to initialise New Relic Opentelemetry use the [SetupNROpenTelemetry] function from the `go-coldbrew/core` package.

### Using

To use New Relic tracing in your app, use the Coldbrew [tracing] and [interceptors] packages. They will setup the New Relic tracing provider and add the tracing middleware to the gRPC and HTTP servers.

You can also add more tracing to your app by [adding tracing] to your functions.

## Prometheus

Coldbrew uses [Prometheus] to collect metrics from the services. Prometheus is an open-source systems monitoring and alerting toolkit originally built at SoundCloud. It includes a time series database, a query language, and a visualization UI.

### Configuring

To configure Prometheus, set the following environment variables as defined in [Config]
- `DISABLE_PROMETHEUS`: Set to `true` to disable Prometheus `/metrics` endpoint
- `ENABLE_PROMETHEUS_GRPC_HISTOGRAM`: Set to `true` to enable Prometheus gRPC histograms

### Initialising

If you app is using [Coldbrew cookiecutter] template, initialisation is done automatically.

If you are using Coldbrew packages in your app, you need to initialise Prometheus manually. Make sure you expose Prometheus `/metrics` endpoint in your app and add the [interceptors] to your gRPC and HTTP servers.

### Using

Coldbrew uses the [prometheus/client_golang] package to collect metrics. To see how to use it check out the [metrics documentation].


## Sentry

[Sentry] is an error tracking tool that helps to monitor and fix crashes in real time. It collects data about the errors and displays it in a dashboard. It also provides alerts when the service is not performing well.

### Configuring

To configure Sentry, set the following environment variables as defined in [Config]
- `SENTRY_DSN`: Sentry DSN
- `ENVIRONMENT`: Environment (e.g. `production`)
- `RELEASE`: App release (e.g. `v1.0.0`)

### Initialising

If you app is using [Coldbrew cookiecutter] template, initialisation is done automatically.

If you are using Coldbrew packages in your app, you need to initialise Sentry manually. To initialise Sentry use the [SetupSentry] function from the `go-coldbrew/core` package.

### Using

To use Sentry in your app, have a look at the [errors documentation].

## Opentelemetry

[Opentelemetry] is a collection of tools that help to collect and analyze telemetry data. It includes a time series database, a query language, and a visualization UI.

### Initialising

If you app is using [Coldbrew cookiecutter] template, initialisation is done automatically.

If you are using Coldbrew packages in your app, you need to initialise Opentelemetry manually. To initialise Opentelemetry follow the [Opentelemetry documentation] and configure the otel exporter to send the data.

To initialise New Relic Opentelemetry use the [SetupNROpenTelemetry] function from the `go-coldbrew/core` package.

### Using

To use Opentelemetry tracing in your app, use the Coldbrew [tracing] and [interceptors] packages.

You can also add more tracing to your app by [adding tracing] to your functions.

## Buf

[Buf] is a tool for managing protocol buffers. It can be used to generate code, lint proto files, and more. Buf simplifies the process of managing proto files and helps to keep them consistent across the team. It also helps to avoid common mistakes and helps to keep the proto files up to date.

[Coldbrew cookiecutter] template includes a `buf.yaml` file that configures Buf to generate code for the gRPC service. The code generation config is stored in the `buf.gen.yaml` file.

## Logger

ColdBrew provides a unified logging setup through the core package.

### Configuring

To configure the logger, set the following environment variables as defined in [Config]:
- `LOG_LEVEL`: Log level (e.g. `debug`, `info`, `warn`, `error`)
- `JSON_LOGS`: Set to `true` to enable JSON output, `false` for logfmt

### Initialising

If your app is using [Coldbrew cookiecutter] template, initialisation is done automatically.

If you are using Coldbrew packages in your app, you need to initialise the logger manually:

```go
import "github.com/go-coldbrew/core"

func main() {
    // SetupLogger configures the logger with the specified log level and format
    // logLevel: "debug", "info", "warn", "error"
    // jsonlogs: true for JSON output, false for logfmt
    err := core.SetupLogger("info", true)
    if err != nil {
        panic(err)
    }
}
```

## Generic OpenTelemetry

ColdBrew supports any OTLP-compatible backend (Jaeger, Honeycomb, etc.) through a generic OpenTelemetry setup.

### Configuring

To configure generic OpenTelemetry, you can use the [OTLPConfig] struct:

```go
type OTLPConfig struct {
    Endpoint             string            // OTLP gRPC endpoint (e.g., "localhost:4317")
    Headers              map[string]string // Custom headers (e.g., API keys)
    ServiceName          string            // Name of your service
    ServiceVersion       string            // Version of your service
    SamplingRatio        float64           // Sampling ratio (0.0 to 1.0)
    Compression          string            // "gzip" or "none"
    UseOpenTracingBridge bool              // Enable OpenTracing compatibility
    Insecure             bool              // Disable TLS (for local development)
}
```

### Initialising

```go
import "github.com/go-coldbrew/core"

func main() {
    config := core.OTLPConfig{
        Endpoint:             "localhost:4317",
        ServiceName:          "my-service",
        ServiceVersion:       "v1.0.0",
        SamplingRatio:        0.1,
        UseOpenTracingBridge: true,
        Insecure:             true,  // for local development
    }
    err := core.SetupOpenTelemetry(config)
    if err != nil {
        panic(err)
    }
}
```

## Jaeger

[Jaeger] is an open-source distributed tracing system. ColdBrew supports Jaeger through the generic OpenTelemetry interface.

### Configuring

To send traces to Jaeger, configure the OTLP endpoint to point to your Jaeger collector:

```go
import "github.com/go-coldbrew/core"

func main() {
    config := core.OTLPConfig{
        Endpoint:             "localhost:4317",  // Jaeger OTLP endpoint
        ServiceName:          "my-service",
        ServiceVersion:       "v1.0.0",
        SamplingRatio:        0.1,
        UseOpenTracingBridge: true,
        Insecure:             true,
    }
    err := core.SetupOpenTelemetry(config)
    if err != nil {
        panic(err)
    }
}
```

## Hystrix-Go

[Hystrix-Go] is a Go implementation of the circuit breaker pattern. ColdBrew provides Prometheus metrics integration for Hystrix.

### Initialising

If your app is using [Coldbrew cookiecutter] template, initialisation is done automatically.

If you are using Coldbrew packages in your app, you need to initialise Hystrix Prometheus manually:

```go
import "github.com/go-coldbrew/core"

func main() {
    // SetupHystrixPrometheus registers Hystrix metrics with Prometheus
    core.SetupHystrixPrometheus()
}
```

## Environment Configuration

ColdBrew provides functions to configure the environment and release information used by monitoring tools.

### Initialising

```go
import "github.com/go-coldbrew/core"

func main() {
    // SetupEnvironment identifies the environment in Sentry and New Relic
    core.SetupEnvironment("production")

    // SetupReleaseName identifies the release in Sentry
    core.SetupReleaseName("v1.0.0")
}
```

## Coldbrew packages

All Coldbrew packages are designed to be used as standalone packages. They can be used in any Go project. They are not tied to Coldbrew and can be used in any Go project.

When you build your service using [Coldbrew cookiecutter] template, it includes the [Core] package which initialises all the packages and sets up the service. You can use the [Core] package in any Go project to set up the service.

To see all the Coldbrew packages, check out the [Coldbrew packages] page.

---
[GRPC Gateway]: https://grpc-ecosystem.github.io/grpc-gateway/
[gRPC Gateway example]: /howto/APIs/#adding-a-new-api-to-your-service
[Buf]: https://buf.build/
[Coldbrew cookiecutter]: /getting-started#using-the-coldbrew-cookiecutter-template
[Prometheus]: https://prometheus.io/
[metrics documentation]: /howto/Metrics/
[New Relic]: https://newrelic.com/
[Sentry]: https://sentry.io/welcome/
[Opentelemetry]: https://opentelemetry.io/
[Jaeger]: https://www.jaegertracing.io/
[Hystrix-Go]: https://pkg.go.dev/github.com/afex/hystrix-go/hystrix
[Go-grpc-middleware]: https://github.com/grpc-ecosystem/go-grpc-middleware
[Core]: https://github.com/go-coldbrew/core/tree/main#readme
[Coldbrew packages]: /packages
[Config]: https://pkg.go.dev/github.com/go-coldbrew/core/config#Config
[adding tracing]: /howto/Tracing/#adding-tracing-to-your-functions
[SetupNewRelic]: https://pkg.go.dev/github.com/go-coldbrew/core#SetupNewRelic
[SetupNROpenTelemetry]: https://pkg.go.dev/github.com/go-coldbrew/core#SetupNROpenTelemetry
[interceptors]: https://pkg.go.dev/github.com/go-coldbrew/interceptors
[tracing]: https://pkg.go.dev/github.com/go-coldbrew/tracing
[prometheus/client_golang]: https://github.com/prometheus/client_golang
[SetupSentry]: https://pkg.go.dev/github.com/go-coldbrew/core#SetupSentry
[Opentelemetry documentation]: https://opentelemetry.io/docs/go/getting-started/
[errors documentation]: /howto/errors/#coldbrew-notifier-package
[OTLPConfig]: https://pkg.go.dev/github.com/go-coldbrew/core#OTLPConfig
[SetupOpenTelemetry]: https://pkg.go.dev/github.com/go-coldbrew/core#SetupOpenTelemetry
[SetupLogger]: https://pkg.go.dev/github.com/go-coldbrew/core#SetupLogger
[SetupHystrixPrometheus]: https://pkg.go.dev/github.com/go-coldbrew/core#SetupHystrixPrometheus
[SetupEnvironment]: https://pkg.go.dev/github.com/go-coldbrew/core#SetupEnvironment
[SetupReleaseName]: https://pkg.go.dev/github.com/go-coldbrew/core#SetupReleaseName
