---
layout: default
title: "Using ColdBrew"
nav_order: 4
description: "How to use ColdBrew in your Go microservices"
permalink: /using
---
# Using ColdBrew
{: .no_toc }

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

This guide covers how to use ColdBrew after you have created a project. If you haven't created a project yet, see the [Getting Started](/getting-started) guide.

## Project Structure

A ColdBrew project generated from the [cookiecutter template](https://github.com/go-coldbrew/cookiecutter-coldbrew) has the following structure:

```
MyApp/
  proto/              # Protocol buffer definitions
    myapp.proto
  service/            # gRPC service implementation
    service.go
    service_test.go
    healthcheck.go
    healthcheck_test.go
  config/
    config.go         # Configuration via environment variables
  version/
    version.go        # Build-time version info
  main.go             # Entry point
  Makefile            # Build, test, lint, run targets
  Dockerfile          # Production container
  go.mod
```

## Defining Your API

ColdBrew services are defined using Protocol Buffers. Edit your `.proto` file to add new RPC methods:

```protobuf
service MySvc {
  rpc SayHello (SayHelloRequest) returns (SayHelloResponse) {
    option (google.api.http) = {
      get: "/api/v1/hello"
    };
  }
}
```

The `google.api.http` annotation automatically creates a REST endpoint via grpc-gateway.

After editing your proto file, regenerate the Go code:

```shell
make generate
```

## Implementing Your Service

Implement the generated gRPC interface in your `service/service.go`:

```go
func (s *svcNameImpl) SayHello(ctx context.Context, req *pb.SayHelloRequest) (*pb.SayHelloResponse, error) {
    return &pb.SayHelloResponse{
        Message: "Hello " + req.GetName(),
    }, nil
}
```

Your service struct implements `core.CBService`, which requires two methods:

- **`InitHTTP(ctx context.Context, mux *runtime.ServeMux, endpoint string, opts []grpc.DialOption)`** — Registers HTTP/REST handlers
- **`InitGRPC(ctx context.Context, s *grpc.Server)`** — Registers gRPC handlers

## Running Your Service

```shell
make run
```

This starts the service with:
- gRPC server on port `9090` (default)
- HTTP gateway on port `9091` (default)
- Prometheus metrics at `/metrics`
- Health check at `/healthcheck` and `/readycheck`
- pprof debug endpoints at `/debug/pprof/`

## Configuration

ColdBrew uses environment variables for configuration. Common settings:

| Variable | Default | Description |
|----------|---------|-------------|
| `GRPC_PORT` | `9090` | gRPC server port |
| `HTTP_PORT` | `9091` | HTTP gateway port |
| `LOG_LEVEL` | `info` | Log level (debug, info, warn, error) |
| `JSON_LOGS` | `true` | JSON formatted logs |
| `ENVIRONMENT` | `""` | Environment name |
| `TRACE_HEADER_NAME` | `x-trace-id` | Header name for trace propagation |
| `NEW_RELIC_APPNAME` | `""` | New Relic application name |
| `NEW_RELIC_LICENSE_KEY` | `""` | New Relic license key |
| `SENTRY_DSN` | `""` | Sentry DSN for error tracking |

See the **[Configuration Reference](/config-reference)** for the complete list of 40+ environment variables including gRPC keepalive, TLS, OpenTelemetry OTLP, Prometheus histogram buckets, and graceful shutdown tuning.

## Adding Interceptors

ColdBrew comes with a comprehensive set of [interceptors](/howto/interceptors) pre-configured. To add custom interceptors:

```go
import "github.com/go-coldbrew/interceptors"

func init() {
    interceptors.AddUnaryServerInterceptor(myCustomInterceptor)
}
```

{: .warning }
Interceptor configuration functions must be called during `init()` — they are not safe for concurrent use.

## What's Next?

- [How-To Guides](/howto) — Detailed guides for tracing, logging, metrics, error handling, and more
- [Integrations](/integrations) — Setting up New Relic, Prometheus, Sentry, and other integrations
- [Packages](/packages) — Browse all ColdBrew packages
