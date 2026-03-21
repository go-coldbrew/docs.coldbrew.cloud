---
layout: default
title: Home
nav_order: 1
description: "Coldbrew is a Go library for creating cloud native applications."
permalink: /
---
# ColdBrew
{: .fs-9 }

Coldbrew is a collection of Go library for creating cloud native applications. It provides ready-made components for quickly creating cloud-native microservices. It also provides a set of stand alone libraries for building resilient, secure, and scalable applications.
{: .fs-6 .fw-300 }

[Get started now](/getting-started){: .btn .btn-primary .fs-5 .mb-4 .mb-md-0 .mr-2 }
[View Packages](/packages){: .btn .fs-5 .mb-4 .mb-md-0 .btn-blue .mr-2}
[How To](/howto){: .btn .fs-5 .mb-4 .mb-md-0 .mr-2 .btn-green}
[View it on GitHub](https://github.com/go-coldbrew/){: .btn .fs-5 .mb-4 .mb-md-0 .mr-2}


## Why ColdBrew ?

ColdBrew is the next evolution of [Orion]. It is a collection of libraries and ready-made components that we have built since 2016 to make our lives easier. We have open-sourced these libraries so that other developers can benefit from them. We have also open-sourced the [cookiecutter] template that we use to create new services that follow [12 factor]. This allows you to quickly create new services with all the bells and whistles.

## Who is using ColdBrew ?

ColdBrew is production ready and is used at [gojek](https://www.gojek.com/en-id/) serving billions of requests per day.

## Dont repeat yourself

ColdBrew integrates with all the popular libraries. We strongly believe in the [DRY] principle. Instead of repeating things we re-use already exisiting and popular open-source libraries, such as:

- [grpc] - grpc server and client
- [grpc-gateway] - RESTful APIs
- [prometheus] - Metrics
- [opentelemetry] - Tracing
- [jaeger] - Tracing
- [opentracing] - Tracing
- [hystrix-go] - Circuit Breaker (deprecated, consider [failsafe-go])
- [new relic] - Monitoring
- [sentry] - Error Reporting
- [go-grpc-middleware] - Middlewares: interceptors, helpers and utilities.

## Next Steps

- [Getting Started]
- [Integrations]
- [How To]
- [Packages]

---
[orion]: https://github.com/carousell/Orion
[grpc]:https://grpc.io/
[grpc-gateway]:https://grpc-ecosystem.github.io/grpc-gateway/
[prometheus]:https://prometheus.io/
[jaeger]:https://www.jaegertracing.io/
[opentracing]:https://opentracing.io/
[hystrix-go]: https://pkg.go.dev/github.com/afex/hystrix-go
[new relic]: https://newrelic.com/
[sentry]: https://sentry.io/
[go-grpc-middleware]: https://pkg.go.dev/github.com/grpc-ecosystem/go-grpc-middleware
[failsafe-go]: https://github.com/failsafe-go/failsafe-go
[grpc_retry]: https://pkg.go.dev/github.com/grpc-ecosystem/go-grpc-middleware/retry
[opentelemetry]: https://opentelemetry.io/
[DRY]: https://en.wikipedia.org/wiki/Don%27t_repeat_yourself
[12 factor]: https://12factor.net/
[getting started]: /getting-started
[cookiecutter]: getting-started#using-the-coldbrew-cookiecutter-template
[packages]: /packages
[integrations]: /integrations
[how to]: /howto
