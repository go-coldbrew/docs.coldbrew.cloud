---
layout: default
title: How To
nav_order: 5
description: "Step-by-step guides for logging, tracing, metrics, error handling, APIs, and debugging in ColdBrew Go services"
permalink: /howto
has_children: true
has_toc: true
---
# How To

Step-by-step guides for building, running, and operating ColdBrew services. The guides are grouped by what you are trying to do — pick the one that matches your task.

## Build

Designing and writing your service.

| I want to... | Read |
|---|---|
| Define gRPC + HTTP endpoints | [APIs](/howto/APIs) |
| Set up gRPC connection pooling | [gRPC](/howto/gRPC) |
| Add structured logging | [Log](/howto/Log) |
| Handle errors with stack traces | [Errors](/howto/errors) |
| Customize the interceptor chain | [Interceptors](/howto/interceptors) |
| Use dependency injection | [Data Builder](/howto/data-builder) |
| Run background workers | [Workers](/howto/workers) |
| Add JWT / API key auth | [Authentication](/howto/auth) |
| Add custom HTTP marshalers or middleware | [HTTP Gateway Extensions](/howto/gateway-extensions) |

## Operate

Running, observing, and shipping your service.

| I want to... | Read |
|---|---|
| Add distributed tracing | [Tracing](/howto/Tracing) |
| Expose Prometheus metrics | [Metrics](/howto/Metrics) |
| Debug requests in production | [Debugging](/howto/Debugging) |
| Handle graceful shutdown | [Signals](/howto/signals) |
| Deploy to Kubernetes | [Production](/howto/production) |
| Manage readiness with workers | [Readiness Patterns](/howto/readiness) |

## Integrate

Connecting ColdBrew to your local environment, repo, and dependencies.

| I want to... | Read |
|---|---|
| Serve Swagger/OpenAPI UI | [Swagger](/howto/swagger) |
| Write tests and benchmarks | [Testing](/howto/testing) |
| Use private Go modules | [Private Modules](/howto/private-modules) |
| Set up local dev with Docker | [Local Development](/howto/local-dev) |

## Advanced

Tuning, optimization, and topics most readers can skip on first pass.

| I want to... | Read |
|---|---|
| Optimize protobuf serialization | [vtprotobuf](/howto/vtproto) |

If you have a How To that you would like to share, please [open an issue](https://github.com/go-coldbrew/docs.coldbrew.cloud/issues)

