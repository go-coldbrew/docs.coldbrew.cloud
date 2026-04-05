---
layout: default
title: "Getting Started"
nav_order: 2
description: "Create and run your first ColdBrew service in 5 minutes with cookiecutter or manual setup"
permalink: /getting-started
---
# Getting Started: Your First ColdBrew Service
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
1 - 1.26
2 - 1.25
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
├── .github/workflows/
│   └── go.yml               # GitHub Actions CI pipeline
├── .gitlab-ci.yml           # GitLab CI pipeline
├── Makefile                 # Build, test, lint, run, Docker targets
├── Dockerfile               # Multi-stage production build
├── .golangci.yml            # Linter configuration
├── .mockery.yaml            # Mock generation config
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
$ curl -s localhost:9091/healthcheck
{"git_commit":"f470560c0a361839763c2abdac8a01b495bfd908","version":"0.1.0","build_date":"2026-03-24-09:44:05","go_version":"go1.26.1","os_arch":"darwin arm64","app":"myapp","branch":"main"}
```

The healthcheck returns build and version information as JSON — useful for quickly identifying which version of your service is running in any environment.

### Ready Check (Kubernetes readiness probe)

```bash
$ curl -s localhost:9091/readycheck
{"git_commit":"f470560c0a361839763c2abdac8a01b495bfd908","version":"0.1.0","build_date":"2026-03-24-09:44:05","go_version":"go1.26.1","os_arch":"darwin arm64","app":"myapp","branch":"main"}
```

Returns the same version JSON when the service is ready to receive traffic. Returns an error if the service hasn't called `SetReady()` yet.

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

{: .note }
After regenerating, the Go compiler will report an error until you implement the new `Greet` method — this is by design. Your proto file is the contract, and the compiler enforces it. You can't forget an endpoint or deploy a half-implemented API.

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
make mock     # Generate mocks for interfaces (via mockery)
```

Both `test` and `lint` should pass out of the box. See the [Testing How-To](/howto/testing/) for details on mocks, benchmarks, and coverage reports.

## Step 9: CI/CD — Already Configured

Your project includes ready-to-use CI pipelines for both GitHub and GitLab. Delete whichever you don't need.

### GitHub Actions (`.github/workflows/go.yml`)

Runs on push to `main`/`master` and on pull requests. Four parallel jobs:

| Job | What it does |
|-----|-------------|
| **build** | Compiles with `make build` |
| **test** | Runs `make test` (race detector + coverage) |
| **benchmark** | Runs `make bench` |
| **lint** | Runs govulncheck + golangci-lint v2 |

Each job has concurrency control so duplicate runs on the same branch are cancelled automatically.

### GitLab CI (`.gitlab-ci.yml`)

Three jobs in a single `test` stage:

| Job | What it does |
|-----|-------------|
| **unit-test** | Runs `make test`, generates Cobertura coverage report |
| **lint** | Runs `make lint` (golangci-lint + govulncheck) |
| **benchmark** | Runs `make bench` |

Go module caching is enabled for faster builds.

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
- **CI/CD pipelines** for GitHub Actions and GitLab CI (build, test, lint, benchmark)

## Alternative: Manual Setup (No Cookiecutter)

If you prefer to set up a project manually without cookiecutter, here's the minimal path:

### 1. Initialize your module

```bash
mkdir myservice && cd myservice
go mod init github.com/yourname/myservice
go get github.com/go-coldbrew/core
```

### 2. Define your proto

Create `proto/myservice.proto`:

```protobuf
syntax = "proto3";

package myservice;

option go_package = "github.com/yourname/myservice/proto";

import "google/api/annotations.proto";

service MyService {
    rpc Echo(EchoRequest) returns (EchoResponse) {
        option (google.api.http) = {
            post: "/api/v1/echo"
            body: "*"
        };
    }
}

message EchoRequest {
    string msg = 1;
}

message EchoResponse {
    string msg = 1;
}
```

### 3. Generate Go code

Create `buf.yaml`:

```yaml
version: v2
modules:
  - path: proto
deps:
  - buf.build/googleapis/googleapis
```

Create `buf.gen.yaml`:

```yaml
version: v2
plugins:
  - remote: buf.build/protocolbuffers/go
    out: proto
    opt: paths=source_relative
  - remote: buf.build/grpc/go
    out: proto
    opt: paths=source_relative
  - remote: buf.build/grpc-ecosystem/gateway
    out: proto
    opt: paths=source_relative
```

Then generate:

```bash
buf dep update
buf generate
```

### 4. Write main.go

```go
package main

import (
    "context"

    "github.com/go-coldbrew/core"
    "github.com/go-coldbrew/core/config"
    "github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
    "google.golang.org/grpc"

    pb "github.com/yourname/myservice/proto"
)

type myService struct {
    pb.UnimplementedMyServiceServer
}

func (s *myService) Echo(ctx context.Context, req *pb.EchoRequest) (*pb.EchoResponse, error) {
    return &pb.EchoResponse{Msg: req.GetMsg()}, nil
}

func (s *myService) InitGRPC(ctx context.Context, server *grpc.Server) error {
    pb.RegisterMyServiceServer(server, s)
    return nil
}

func (s *myService) InitHTTP(ctx context.Context, mux *runtime.ServeMux, endpoint string, opts []grpc.DialOption) error {
    return pb.RegisterMyServiceHandlerFromEndpoint(ctx, mux, endpoint, opts)
}

func main() {
    cfg := config.GetColdBrewConfig()
    cb := core.New(cfg)
    cb.SetService(&myService{})
    cb.Run()
}
```

### 5. Run it

```bash
go mod tidy
go run .
```

Your service starts on `:9090` (gRPC) and `:9091` (HTTP) with metrics, health checks, and profiling endpoints — all wired automatically.

## Next Steps

- **[How-To Guides](/howto)** — Tracing, logging, metrics, error handling, and more
- **[Production Deployment](/howto/production)** — Kubernetes manifests, health probes, tracing, and graceful shutdown
- **[Integrations](/integrations)** — Connect New Relic, Prometheus, Sentry, Jaeger
- **[FAQ](/faq)** — Common questions and gotchas
