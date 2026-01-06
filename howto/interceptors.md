---
layout: default
title: "Interceptors"
parent: "How To"
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

Coldbrew uses interceptors to implement response time logging in [ResponseTimeLoggingInterceptor]. The interceptor is enabled by default and logs the response time of each request in the following format:

```json
{"@timestamp":"2023-04-23T22:07:38.857192+08:00","caller":"interceptors@v0.1.7/interceptors.go:248","error":null,"grpcMethod":"/com.github.ankurs.MySvc/Echo","level":"info","took":"49.542µs","trace":"50337410-4bcd-48ce-b8d4-6b42f2ac5503"}
```

### Filtering response time logs

Its possible to filter out response time logs message by using a [FilterFunc], Coldbrew provides a [default filter function] implementation that filter out common logs like healthchek, readycheck, server reflection, etc.

You can add more methods to filter out by appending to the default [FilterMethods] list. For example, to filter out all methods that starts with `com.github.ankurs.MySvc/`:

```go
import (
    "github.com/go-coldbrew/interceptors"
)

func main() {
    interceptors.FilterMethods = append(interceptors.FilterMethods, "com.github.ankurs.MySvc/")
}
```

You can also provide your own filter function by calling the [SetFilterFunc] variable:

```go
import (
    "github.com/go-coldbrew/interceptors"
)

func main() {
    interceptors.SetFilterFunc(context.Background(), func(ctx context.Context, method string) bool {
        return strings.HasPrefix(method, "com.github.ankurs.MySvc/")
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
)

func main() {
    ctx := context.Background()
    conn, err := grpc.Dial(
        "localhost:8080",
        grpc.WithInsecure(),
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
[SetFilterFunc]: https://pkg.go.dev/github.com/go-coldbrew/interceptors#SetFilterFunc
[AddUnaryServerInterceptor]: https://pkg.go.dev/github.com/go-coldbrew/interceptors#AddUnaryServerInterceptor
[AddUnaryClientInterceptor]: https://pkg.go.dev/github.com/go-coldbrew/interceptors#AddUnaryClientInterceptor
