---
layout: default
title: "gRPC"
parent: "How To"
nav_order: 2
description: "How to use gRPC with ColdBrew: connection pooling, client setup with grpcpool, and building gRPC-first microservices in Go"
---
## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}


{: .note}
If you are not familiar with gRPC, you can learn more about it at [grpc.io](https://grpc.io/).

## Using gRPC with ColdBrew

ColdBrew is gRPC first, which means that gRPC APIs are the primary APIs and HTTP/JSON APIs are generated from the gRPC APIs. This approach is different from other frameworks where HTTP/JSON APIs are independent from gRPC APIs.

The best way to get started with gRPC in ColdBrew is to use the [ColdBrew cookiecutter] to generate a new project. The cookiecutter will generate a project with a sample gRPC service and a sample HTTP/JSON service. You can use the sample gRPC service as a template to create your own gRPC service.

You can than follow the `README.md` in the project or [Building and Configuring APIs] how to see how to use the generated service.

## Client-side connection pool

ColdBrew provides a simple gRPC connection pool implementation called [grpcpool]. You can use this package to create a connection pool for your gRPC services.

The package provides a [grpcpool.Dial] function that can be used to create a connection pool for a gRPC service. The function takes a `grpc.DialOption` as an argument. You can use this option to configure the gRPC client connection. For example, you can use this option to configure TLS, authentication, etc.

The following example shows how to create a connection pool for a gRPC service:

```go

import (
    "github.com/go-coldbrew/grpcpool"
    "google.golang.org/grpc"
    "google.golang.org/grpc/credentials/insecure"
)


func main() {
    // Create a connection pool for a gRPC service with 3 connections.
    pool, err := grpcpool.Dial("localhost:50051", 3, grpc.WithTransportCredentials(insecure.NewCredentials()))
    if err != nil {
        // Handle error.
    }
    defer pool.Close()

    // Get a connection from the pool.
    conn := pool.Conn()

    // Use the connection for your gRPC calls.
    // Note: connections are not returned to the pool, they are reused internally.
    _ = conn
}
```

[grpcpool] implements [grpc.ClientConnInterface] to enable it to be used directly with generated proto stubs

```go

import (
    "context"
    "fmt"

    "github.com/go-coldbrew/grpcpool"
    "google.golang.org/grpc"
    "google.golang.org/grpc/credentials/insecure"
)

func main() {
    // Create a connection pool for a gRPC service with 2 connections.
    pool, err := grpcpool.Dial("localhost:50051", 2, grpc.WithTransportCredentials(insecure.NewCredentials()))
    if err != nil {
        // Handle error.
    }

    // Use the connection with generated proto stubs.
    client := pb.NewGreeterClient(pool)

    // make the call
    resp, err := client.SayHello(context.Background(), &pb.HelloRequest{Name: "World"})
    if err != nil {
        // Handle error.
    }
    fmt.Println(resp.Message)

    // Close the pool.
    pool.Close()
}
```

## Calling other services

When your service makes outbound gRPC calls, three concerns usually come up together — the connection pool above handles transport, and these handle reliability:

- **Circuit breaking and retries** — register an executor with `interceptors.SetDefaultExecutor` and bring your own resilience library ([failsafe-go] is recommended). See [Circuit Breaker / Resilience](/integrations/#circuit-breaker--resilience) for the full setup, per-method circuit breakers, and excluded errors.
- **Per-call timeouts** — pass a deadline via `context.WithTimeout` on the client side and call the returned `cancel` (typically `defer cancel()`) so the timer is released as soon as the call returns. The server-side default is `GRPC_SERVER_DEFAULT_TIMEOUT_IN_SECONDS` (see [Configuration Reference](/config-reference)).
- **Client-side tracing and metrics** — the default client interceptors propagate the trace ID and emit `grpc_client_*` Prometheus metrics automatically. See [Interceptors](/howto/interceptors#adding-interceptors-to-your-grpc-client) to add your own.

[failsafe-go]: https://github.com/failsafe-go/failsafe-go

## Wrapping existing connections

You can also use existing gRPC connections with [grpcpool] by wrapping it with [grpcpool.New] function.

```go

import (
    "context"
    "fmt"

    "github.com/go-coldbrew/grpcpool"
    "google.golang.org/grpc"
    "google.golang.org/grpc/credentials/insecure"
)

func main() {
    // Create a gRPC connection.
    conn, err := grpc.NewClient("localhost:50051", grpc.WithTransportCredentials(insecure.NewCredentials()))
    if err != nil {
        // Handle error.
    }

    // Create a connection pool for the gRPC connection.
    pool := grpcpool.New([]*grpc.ClientConn{conn})

    // Use the connection with generated proto stubs.
    client := pb.NewGreeterClient(pool)

    // make the call
    resp, err := client.SayHello(context.Background(), &pb.HelloRequest{Name: "World"})
    if err != nil {
        // Handle error.
    }
    fmt.Println(resp.Message)

    // Close the connection.
    conn.Close()
}
```

---
[ColdBrew cookiecutter]: /getting-started
[Building and Configuring APIs]: /howto/APIs
[grpcpool]: https://pkg.go.dev/github.com/go-coldbrew/grpcpool
[grpcpool.Dial]: https://pkg.go.dev/github.com/go-coldbrew/grpcpool#Dial
[grpc.ClientConnInterface]: https://pkg.go.dev/google.golang.org/grpc#ClientConnInterface
[grpcpool.New]: https://pkg.go.dev/github.com/go-coldbrew/grpcpool#New
