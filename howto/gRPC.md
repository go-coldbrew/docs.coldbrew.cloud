---
layout: default
title: "gRPC"
parent: "How To"
description: "How to use gRPC with Coldbrew"
---
## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}


{: .note}
If you are not familiar with gRPC, you can learn more about it at [grpc.io](https://grpc.io/).

## Using gRPC with Coldbrew

Coldbrew is gRPC first, which means that gRPC APIs are the primary APIs and HTTP/JSON APIs are generated from the gRPC APIs. This approach is different from other frameworks where HTTP/JSON APIs are independent from gRPC APIs.

Best way to get started with gRPC in Coldbrew is to use the [Coldbrew cookiecutter] to generate a new project. The cookiecutter will generate a project with a sample gRPC service and a sample HTTP/JSON service. You can use the sample gRPC service as a template to create your own gRPC service.

You can than follow the `README.md` in the project or [Building and Configuring APIs] how to see how to use the generated service.

## Client side connection pool

Coldbrew provides a simple gRPC connection pool implementation called [grpcpool]. You can use this package to create a connection pool for your gRPC services.

The package provides a [grpcpool.Dial] function that can be used to create a connection pool for a gRPC service. The function takes a `grpc.DialOption` as an argument. You can use this option to configure the gRPC client connection. For example, you can use this option to configure TLS, authentication, etc.

The following example shows how to create a connection pool for a gRPC service:

```go

import (
    "github.com/go-coldbrew/grpcpool"
    "google.golang.org/grpc"
)


func main() {
    // Create a connection pool for a gRPC service with 3 connections.
    pool, err := grpcpool.Dial("localhost:50051", 3, grpc.WithInsecure())
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
    "github.com/go-coldbrew/grpcpool"
    "google.golang.org/grpc"
)

func main() {
    // Create a connection pool for a gRPC service with 2 connections.
    pool, err := grpcpool.Dial("localhost:50051", 2, grpc.WithInsecure())
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

    // Close the connection.
    conn.Close()
}
```

You can also use existing gRPC connections with [grpcpool] by wrapping it with [grpcpool.New] function.

```go

import (
    "github.com/go-coldbrew/grpcpool"
    "google.golang.org/grpc"
)

func main() {
    // Create a gRPC connection.
    conn, err := grpc.Dial("localhost:50051", grpc.WithInsecure())
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
[Coldbrew cookiecutter]: /getting-started
[Building and Configuring APIs]: /howto/APIs
[grpcpool]: https://pkg.go.dev/github.com/go-coldbrew/grpcpool
[grpcpool.Dial]: https://pkg.go.dev/github.com/go-coldbrew/grpcpool#Dial
[grpc.ClientConnInterface]: https://pkg.go.dev/google.golang.org/grpc#ClientConnInterface
[grpcpool.New]: https://pkg.go.dev/github.com/go-coldbrew/grpcpool#New
