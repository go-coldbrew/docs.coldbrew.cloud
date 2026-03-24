---
layout: default
title: "Quickstart"
nav_order: 2
description: "Create and run your first ColdBrew service in 5 minutes"
permalink: /quickstart
---
# Quickstart: Your First ColdBrew Service
{: .no_toc }

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Prerequisites

Before you begin, install:

- **[Go 1.25+](https://go.dev/dl/)** — `go version` should show 1.25 or later
- **[cookiecutter](https://cookiecutter.readthedocs.io/)** — `brew install cookiecutter` or `pip install cookiecutter`
- **[buf](https://buf.build/docs/installation)** — for protobuf code generation

## Step 1: Generate Your Project

```bash
cookiecutter gh:go-coldbrew/cookiecutter-coldbrew
```

Answer the prompts:

```
source_path [github.com/ankurs]: github.com/yourname
app_name [MyApp]: EchoServer
grpc_package [com.github.ankurs]: com.github.yourname
service_name [MySvc]: EchoSvc
project_short_description [A Golang project.]: My first ColdBrew service
docker_image [alpine:latest]:
docker_build_image [golang]:
Select docker_build_image_version:
1 - 1.25
2 - 1.26
Choose from 1, 2 [1]: 1
```

{: .note }
The exact Go image versions listed in this menu may vary depending on the cookiecutter template version you are using. Follow the options shown when you run `cookiecutter`.

## Step 2: Explore What You Got

```bash
cd EchoServer/
```

Here's what was generated:

```
EchoServer/
├── main.go                  # Entry point — wires ColdBrew framework
├── config/
│   └── config.go            # Configuration via environment variables
├── service/
│   ├── service.go           # Your business logic goes here
│   ├── service_test.go      # Tests and benchmarks
│   ├── healthcheck.go       # Kubernetes liveness/readiness probes
│   └── healthcheck_test.go
├── proto/
│   └── echoserver.proto     # API definition (source of truth)
├── version/
│   └── version.go           # Build-time version info
├── third_party/OpenAPI/     # Swagger UI assets (embedded)
├── Makefile                 # Build, test, lint, run, Docker targets
├── Dockerfile               # Multi-stage production build
├── buf.yaml                 # Protobuf linting config
├── buf.gen.yaml             # Code generation config
└── local.env.example        # Environment variable template
```

**Key insight:** Your API is defined in `proto/echoserver.proto`. ColdBrew generates both gRPC handlers and REST endpoints from this single source.

## Step 3: Build and Run

```bash
make run
```

This compiles and starts your service. You should see log output indicating:
- gRPC server listening on `:9090`
- HTTP gateway listening on `:9091`

## Step 4: Verify Everything Works

Open a new terminal and test each endpoint:

### Health Check (Kubernetes liveness probe)

```bash
curl -s localhost:9091/healthcheck
```

Expected: JSON with build and version information (e.g., `{"Version":"dev","GitCommit":"...","BuildDate":"..."}`). This is useful for quickly identifying which version of your service is running in any environment — just curl the healthcheck endpoint.

### Ready Check (Kubernetes readiness probe)

```bash
curl -s localhost:9091/readycheck
```

Expected: Same version JSON when the service is ready to receive traffic. Returns an error if the service hasn't called `SetReady()` yet.

### Echo Endpoint (your demo API)

```bash
curl -s -X POST localhost:9091/api/v1/example/echo \
  -H "Content-Type: application/json" \
  -d '{"msg": "hello coldbrew"}'
```

Expected: `{"msg":"hello coldbrew"}`

### Prometheus Metrics

```bash
curl -s localhost:9091/metrics | head -20
```

You should see Prometheus metrics including `grpc_server_handled_total`, `grpc_server_handling_seconds`, and more.

### Swagger UI

Open [http://localhost:9091/swagger/](http://localhost:9091/swagger/) in your browser. You'll see interactive API documentation with all your endpoints.

### pprof Profiling

```bash
curl -s localhost:9091/debug/pprof/ | head -5
```

Go's built-in profiler is available for debugging performance issues.

### gRPC Reflection (optional)

If you have [grpcurl](https://github.com/fullstorydev/grpcurl) installed:

```bash
grpcurl -plaintext localhost:9090 list
```

This lists all registered gRPC services.

## Step 5: Understand the Code

### main.go — Entry Point

The entry point creates a ColdBrew instance and wires everything together:

```go
cb := core.New(cfg)           // Create ColdBrew with config
cb.SetOpenAPIHandler(...)     // Enable Swagger UI
cb.SetService(&cbSvc{})      // Register your service
cb.Run()                      // Start (blocks until shutdown signal)
```

Your service struct implements `core.CBService` with three methods:
- **`InitGRPC()`** — Registers gRPC handlers
- **`InitHTTP()`** — Registers HTTP gateway handlers (auto-generated from proto)
- **`Stop()`** — Cleanup on graceful shutdown

### service/service.go — Business Logic

This is where you write your application logic. The template includes demo `Echo` and `Error` endpoints:

```go
func (s *SvcNameImpl) Echo(ctx context.Context, req *pb.EchoRequest) (*pb.EchoResponse, error) {
    return &pb.EchoResponse{Msg: req.GetMsg()}, nil
}
```

### proto/echoserver.proto — API Definition

Your API is defined as a protobuf service. Each RPC method has an HTTP annotation that creates a REST endpoint automatically:

```protobuf
rpc Echo(EchoRequest) returns (EchoResponse) {
    option (google.api.http) = {
        post: "/api/v1/example/echo"
        body: "*"
    };
}
```

## Step 6: Add Your Own Endpoint

Let's add a `Greet` endpoint to your service.

### 1. Define the proto

Add to `proto/echoserver.proto`:

```protobuf
message GreetRequest {
    string name = 1;
}

message GreetResponse {
    string greeting = 1;
}
```

Add the RPC method to your service block:

```protobuf
rpc Greet(GreetRequest) returns (GreetResponse) {
    option (google.api.http) = {
        get: "/api/v1/greet/{name}"
    };
}
```

### 2. Regenerate code

```bash
make generate
```

This runs `buf generate` and creates the Go code for your new message types and service interface.

### 3. Implement the handler

Add to `service/service.go`:

```go
func (s *SvcNameImpl) Greet(ctx context.Context, req *pb.GreetRequest) (*pb.GreetResponse, error) {
    return &pb.GreetResponse{
        Greeting: "Hello, " + req.GetName() + "!",
    }, nil
}
```

### 4. Test it

```bash
make run
```

In another terminal:

```bash
# REST endpoint (auto-generated from proto)
curl -s localhost:9091/api/v1/greet/World
# => {"greeting":"Hello, World!"}
```

You defined the API once in protobuf and got both gRPC and REST for free.

## Step 7: Run in Docker

```bash
# Build the Docker image
make build-docker

# Run the container
make run-docker
```

The Dockerfile uses a multi-stage build: compiles a static Go binary in the builder stage, then copies it to a minimal Alpine image. Ports 9090 (gRPC) and 9091 (HTTP) are exposed.

## Step 8: Run Tests

```bash
make test     # Tests with race detector + coverage
make lint     # golangci-lint + govulncheck
```

Both should pass out of the box.

## What's Built In (You Didn't Have to Configure)

Everything below was set up automatically by ColdBrew:

- **Structured JSON logging** with trace ID propagation
- **Distributed tracing** support (OpenTelemetry, Jaeger, New Relic)
- **Prometheus metrics** for every gRPC method (latency, error rate, in-flight)
- **gRPC interceptors** for logging, tracing, metrics, error notification, panic recovery
- **Health checks** for Kubernetes liveness/readiness probes
- **Graceful shutdown** on SIGTERM/SIGINT (Kubernetes pod termination)
- **pprof profiling** endpoints for debugging
- **Swagger UI** for interactive API exploration
- **Race-detected tests** via `make test`
- **Vulnerability scanning** via `make lint` (includes govulncheck)

## Next Steps

- **[Using ColdBrew](/using)** — Configure ports, environment variables, and interceptors
- **[How-To Guides](/howto)** — Tracing, logging, metrics, error handling, and more
- **[Integrations](/integrations)** — Connect New Relic, Prometheus, Sentry, Jaeger
- **[FAQ](/faq)** — Common questions and gotchas
