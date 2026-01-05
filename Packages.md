---
layout: default
title: Packages
description: "ColdBrew packages documentation"
permalink: /packages
---
# Packages
{: .no_toc }

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

## [Core]
The core module is the base module and provides the base implementation for ColdBrew. It works in conjunction with the other modules to provide the full functionality of Cold Brew.

Documentation can be found at [core-docs]

### [Config]
Coldbrew config package contains the configuration for the core package. It uses [envconfig] to load the configuration from the environment variables.

Documentation can be found at [config-docs]

## [Log]
log provides a minimal interface for structured logging in services. It provides a simple interface to log errors, warnings, info and debug messages. It also provides a mechanism to add contextual information to logs. We provide implementations for gokit, logrus and zap.

Documentation can be found at [log-docs]

## [Interceptors]
Interceptors provides a common set of reusable interceptors for grpc services

Documentation can be found at [interceptor-docs]

## [Errors]
errors provides an implementation of golang error with stack strace information attached to it, the error objects created by this package are compatible with https://golang.org/pkg/errors/

Documentation can be found at [errors-docs]

### [Notifier]
notifier provides notifier services for error reporting (airbrake, bugsnag, rollbar, sentry). Notifier replies on [Errors] package to get the stack trace information.

Documentation can be found at [notifier-docs]

## [Tracing]

Tracing is a library that provides distributed tracing to Go applications. It offers features such as collecting performance data of an application, identifying where requests are spending most of their time, and segmenting requests. It supports exporting traces to 3rd-party services such as Jaeger, Zipkin, Opentelemetry, and NewRelic.

Documentation can be found at [tracing-docs]

## [Hystrix Prometheus]
hystrixprometheus provides a Prometheus metrics collector for Hystrix (https://github.com/afex/hystrix-go). This is a workaround for hystrix-go not supporting the prometheus registry

Documentation can be found at [hystrixprometheus-docs]

## [grpcpool]
grpcpool is a pool of grpc.ClientConns that can be used to make requests to a grpc server. It implements grpc.ClientConnInterface to enable it to be used directly with generated proto stubs.

Documentation can be found at [grpcpool-docs]

## [Data Builder]
Data builder is a library to compile and execute data-processing logic. Users can express any data-processing logic as functions that accept and return structs. Based on these struct types, the library is able to resolve dependencies at compile time to catch issues with the computation graph (such as missing inputs, missing data-builder functions, cyclic dependencies). Compilation infers a sequence in which the data-processing functions can be run (and can support parallel execution). Any App that acts on a request, processes it in multiple steps, and returns some data that depends on these steps could be written using data-builder.

Documentation can be found at [data-builder-docs]

---
[Core]: https://github.com/go-coldbrew/core/tree/main#readme
[core-docs]: https://pkg.go.dev/github.com/go-coldbrew/core
[Config]: https://github.com/go-coldbrew/core/tree/main/config#readme
[config-docs]: https://pkg.go.dev/github.com/go-coldbrew/core/config
[Log]: https://github.com/go-coldbrew/log/tree/main#readme
[log-docs]: https://pkg.go.dev/github.com/go-coldbrew/log
[Interceptors]: https://github.com/go-coldbrew/interceptors/tree/main#readme
[interceptor-docs]: https://pkg.go.dev/github.com/go-coldbrew/interceptors
[Errors]: https://github.com/go-coldbrew/errors/tree/main#readme
[errors-docs]: https://pkg.go.dev/github.com/go-coldbrew/errors
[Notifier]: https://github.com/go-coldbrew/errors/tree/main/notifier#readme
[notifier-docs]: https://pkg.go.dev/github.com/go-coldbrew/errors/notifier
[Tracing]: https://github.com/go-coldbrew/tracing/tree/main#readme
[tracing-docs]: https://pkg.go.dev/github.com/go-coldbrew/tracing
[Hystrix Prometheus]: https://github.com/go-coldbrew/hystrixprometheus#readme
[hystrixprometheus-docs]: https://pkg.go.dev/github.com/go-coldbrew/hystrixprometheus
[grpcpool]: https://github.com/go-coldbrew/grpcpool#readme
[grpcpool-docs]: https://pkg.go.dev/github.com/go-coldbrew/grpcpool
[Data Builder]: https://github.com/go-coldbrew/data-builder/tree/main#readme
[data-builder-docs]: https://pkg.go.dev/github.com/go-coldbrew/data-builder
