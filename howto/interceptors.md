---
layout: default
title: "Interceptors"
parent: "How To"
nav_order: 7
description: "Configuring gRPC interceptors in ColdBrew"
---
## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

## Overview
When you create a new service with [ColdBrew cookiecutter] it will automatically add tracing (New Relic / Opentelemetry) to your gRPC services. This is done by adding the [interceptors] to your gRPC server.

{: .note .note-info }
To disable coldbrew provided interceptors you can call the function [UseColdBrewServcerInterceptors].

## Response Time Logging

ColdBrew uses interceptors to implement response time logging in [ResponseTimeLoggingInterceptor]. The interceptor is enabled by default and logs the response time of each request in the following format:

```json
{"@timestamp":"2023-04-23T22:07:38.857192+08:00","caller":"interceptors@v0.1.7/interceptors.go:248","error":null,"grpcMethod":"/com.github.ankurs.MySvc/Echo","level":"info","took":"49.542µs","trace":"50337410-4bcd-48ce-b8d4-6b42f2ac5503"}
```

### Filtering response time logs

It's possible to filter out response time log messages by using a [FilterFunc]. ColdBrew provides a [default filter function] implementation that filters out common logs like healthcheck, readycheck, server reflection, etc.

You can replace the default filter list using [SetFilterMethods]. This **overwrites** the entire list, so include the defaults if you want to keep them. Matching is **case-insensitive** (entries and method names are lowercased internally) and works for both gRPC methods and HTTP paths:

```go
import (
    "context"
    "github.com/go-coldbrew/interceptors"
)

func init() {
    interceptors.SetFilterMethods(context.Background(), []string{
        "healthcheck", "readycheck", "serverreflectioninfo", // defaults
        "/echo",           // exclude HTTP path /echo
        "mysvc/echo",      // exclude gRPC method /com.github.ankurs.MySvc/Echo
    })
}
```

For more advanced filtering, provide your own [FilterFunc] via [SetFilterFunc]. The function receives the **original-case** method name and the request context, which lets you distinguish gRPC from HTTP requests. Return `true` to include a method in tracing/logging, or `false` to exclude it:

```go
import (
    "context"
    "strings"
    "github.com/go-coldbrew/interceptors"
    "google.golang.org/grpc"
)

func init() {
    interceptors.SetFilterFunc(context.Background(), func(ctx context.Context, method string) bool {
        if _, ok := grpc.Method(ctx); ok {
            // gRPC: only trace MyService methods
            return strings.Contains(method, "MySvc")
        }
        // HTTP: trace everything except health and ready checks
        return method != "/healthcheck" && method != "/readycheck"
    })
}
```

## Adding interceptors to your gRPC server

If you want to add interceptors to your gRPC server, you can use the [Default Interceptors] from [interceptors] package to add the ColdBrew interceptors to your gRPC server.

Example:

```go
import (
    "context"
    "github.com/go-coldbrew/interceptors"
    "github.com/go-coldbrew/log"
    "google.golang.org/grpc"
)

func main() {
    server := grpc.NewServer(
        // Add the ColdBrew interceptors to your gRPC server to add tracing/metrics to your gRPC server calls
        grpc.ChainUnaryInterceptor(interceptors.DefaultInterceptors()...),
    )
    pb.RegisterHelloWorldServer(server, &HelloWorldServer{})
    if err := server.Serve(lis); err != nil {
        log.Error(context.Background(), "failed to serve", err)
        panic(err)
    }
}
```

{: .note .note-info }
If you are using ColdBrew cookiecutter, the interceptors will be added automatically to your gRPC server.

## Adding interceptors to your gRPC client

ColdBrew provides gRPC client interceptors to add tracing/metrics to your gRPC client. You can add [Default Client Interceptors] which are a collection of interceptors provided by ColdBrew, or you can add your own interceptors.

Example:

```go
import (
    "github.com/go-coldbrew/interceptors"
    "github.com/go-coldbrew/log"
    "google.golang.org/grpc"
    "google.golang.org/grpc/credentials/insecure"
)

func main() {
    ctx := context.Background()
    conn, err := grpc.NewClient(
        "localhost:8080",
        grpc.WithTransportCredentials(insecure.NewCredentials()),
        // Add the ColdBrew interceptors to your gRPC client to add tracing/metrics to your gRPC client calls
        grpc.WithChainUnaryInterceptor(interceptors.DefaultClientInterceptors()...),
    )
    if err != nil {
        log.Error(ctx, "failed to dial", err)
        panic(err)
    }
    defer conn.Close()
    client := pb.NewHelloWorldClient(conn)
    resp, err := client.HelloWorld(ctx, &pb.HelloWorldRequest{})
    if err != nil {
        log.Error(ctx, "failed to call", err)
        panic(err)
    }
    log.Info(ctx, resp)
}
```

## Proto Validation

ColdBrew includes a [protovalidate](https://github.com/bufbuild/protovalidate) interceptor in the default chain. It validates incoming messages using annotations defined in your `.proto` files and returns `InvalidArgument` on failure. Validation runs on both gRPC and HTTP gateway requests — the HTTP gateway translates to gRPC internally, so the interceptor covers both transports from a single annotation.

### Adding validation rules

First, add `buf.build/bufbuild/protovalidate` to your `buf.yaml` deps and run `buf dep update`. Then add annotations to your proto:

```protobuf
import "buf/validate/validate.proto";

message CreateUserRequest {
    string email = 1 [(buf.validate.field).string.email = true];
    string name = 2 [(buf.validate.field).string.min_len = 1];
    int32 age = 3 [(buf.validate.field).int32 = {gte: 0, lte: 150}];
}
```

No code changes needed — the interceptor validates automatically.

### Custom constraints

Add custom validation options during `init()`:

```go
func init() {
    interceptors.SetProtoValidateOptions(
        protovalidate.WithCustomConstraints(myConstraints...),
    )
}
```

### Disabling

Set `DISABLE_PROTO_VALIDATE=true` to skip validation entirely.

## Rate limiting

ColdBrew includes a built-in per-pod token bucket rate limiter. It is **disabled by default** and must be explicitly enabled.

### Enabling via environment variables

```yaml
env:
  - name: RATE_LIMIT_PER_SECOND
    value: "100"   # 100 requests per second per pod
  - name: RATE_LIMIT_BURST
    value: "50"    # allow bursts up to 50
```

{: .important }
This is a **per-pod in-memory limit**. With N pods, the effective cluster-wide limit is N × `RATE_LIMIT_PER_SECOND`. For cluster-wide rate limiting, use a custom limiter (see below) or your load balancer.

When a request exceeds the rate limit, the interceptor returns a `ResourceExhausted` gRPC status code.

### Custom per-API rate limiter

For different rate limits per API method, implement the [`ratelimit.Limiter`](https://pkg.go.dev/github.com/grpc-ecosystem/go-grpc-middleware/v2/interceptors/ratelimit#Limiter) interface and register it during initialization:

```go
import (
    "context"
    "fmt"

    "github.com/go-coldbrew/interceptors"
    ratelimit "github.com/grpc-ecosystem/go-grpc-middleware/v2/interceptors/ratelimit"
    "github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
    "golang.org/x/time/rate"
    "google.golang.org/grpc"
)

// Compile-time check that perMethodLimiter implements the interface.
var _ ratelimit.Limiter = (*perMethodLimiter)(nil)

type perMethodLimiter struct {
    limiters map[string]*rate.Limiter
    fallback *rate.Limiter
}

func (l *perMethodLimiter) Limit(ctx context.Context) error {
    // grpc.Method works for native gRPC calls;
    // runtime.RPCMethod works for HTTP→gRPC via grpc-gateway
    method, ok := grpc.Method(ctx)
    if !ok {
        method, ok = runtime.RPCMethod(ctx)
    }
    if !ok {
        method = "unknown"
    }
    limiter, found := l.limiters[method]
    if !found {
        limiter = l.fallback
    }
    if !limiter.Allow() {
        return fmt.Errorf("rate limit exceeded for %s", method)
    }
    return nil
}

func init() {
    interceptors.SetRateLimiter(&perMethodLimiter{
        limiters: map[string]*rate.Limiter{
            "/myservice.v1.UserService/CreateUser": rate.NewLimiter(10, 5),   // 10 rps
            "/myservice.v1.UserService/ListUsers":  rate.NewLimiter(100, 50), // 100 rps
        },
        fallback: rate.NewLimiter(50, 25), // 50 rps default
    })
}
```

### Distributed rate limiting

For rate limiting across pods or per-tenant, implement `ratelimit.Limiter` with a distributed backend. Libraries that work well with ColdBrew's limiter interface:

| Library | Backend | Notes |
|---------|---------|-------|
| [mennanov/limiters](https://github.com/mennanov/limiters) | Redis, etcd, DynamoDB, memory | Most flexible — has explicit gRPC example, multiple algorithms |
| [go-redis/redis_rate](https://github.com/go-redis/redis_rate) | Redis | GCRA algorithm, good if you already use go-redis (last release 2023 — check for activity) |
| [sethvargo/go-limiter](https://github.com/sethvargo/go-limiter) | Redis, memory | Clean API, actively maintained |

For large-scale multi-service rate limiting, consider a dedicated rate limiting service like [gubernator](https://github.com/gubernator-io/gubernator) (peer-to-peer, no Redis) or [Envoy ratelimit](https://github.com/envoyproxy/ratelimit) (Redis-backed).

### Disabling

Set `DISABLE_RATE_LIMIT=true` to remove the rate limiting interceptor from the chain entirely.

## Authentication

The [cookiecutter template][ColdBrew cookiecutter] includes ready-to-use JWT and API key authentication interceptors built on [go-grpc-middleware/v2 auth](https://github.com/grpc-ecosystem/go-grpc-middleware/tree/main/interceptors/auth). These interceptors are wired by default — set `JWT_SECRET` or `API_KEYS` environment variables to enable them.

For full documentation, see the [Authentication How-To](/howto/auth/).

## Adding custom interceptors to Default interceptors

You can add your own interceptors to the [Default Interceptors] by appending to the list of interceptors.

Use the function [AddUnaryServerInterceptor] and [AddUnaryClientInterceptor] to add your own interceptors to the default server and client interceptors.

---

[TraceId interceptor]: https://pkg.go.dev/github.com/go-coldbrew/interceptors#TraceIdInterceptor
[go-coldbrew/tracing]: https://pkg.go.dev/github.com/go-coldbrew/tracing
[ColdBrew cookiecutter]: /getting-started
[interceptors]: https://pkg.go.dev/github.com/go-coldbrew/interceptors
[UseColdBrewServcerInterceptors]: https://pkg.go.dev/github.com/go-coldbrew/interceptors#UseColdBrewServerInterceptors
[Default Client Interceptors]: https://pkg.go.dev/github.com/go-coldbrew/interceptors#DefaultClientInterceptors
[Default Interceptors]: https://pkg.go.dev/github.com/go-coldbrew/interceptors#DefaultInterceptors
[ResponseTimeLoggingInterceptor]: https://pkg.go.dev/github.com/go-coldbrew/interceptors#ResponseTimeLoggingInterceptor
[FilterFunc]: https://pkg.go.dev/github.com/go-coldbrew/interceptors#FilterFunc
[default filter function]: https://pkg.go.dev/github.com/go-coldbrew/interceptors#FilterMethodsFunc
[FilterMethods]: https://pkg.go.dev/github.com/go-coldbrew/interceptors#FilterMethods
[SetFilterMethods]: https://pkg.go.dev/github.com/go-coldbrew/interceptors#SetFilterMethods
[SetFilterFunc]: https://pkg.go.dev/github.com/go-coldbrew/interceptors#SetFilterFunc
[AddUnaryServerInterceptor]: https://pkg.go.dev/github.com/go-coldbrew/interceptors#AddUnaryServerInterceptor
[AddUnaryClientInterceptor]: https://pkg.go.dev/github.com/go-coldbrew/interceptors#AddUnaryClientInterceptor
