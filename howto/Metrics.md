---
layout: default
title: "Metrics"
parent: "How To"
---
## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

## How Metrics Work in Coldbrew

Coldbrew uses [Prometheus](https://prometheus.io/) to collect service metrics. By Default, Coldbrew will expose a `/metrics` endpoint that will return the metrics in the [Prometheus exposition format](https://prometheus.io/docs/instrumenting/exposition_formats/) on the configured [HTTP port].

A collection of metrics are collected by default, including:
* Golang runtime metrics (e.g. memory usage, goroutine count, etc.)
* gRPC Client/Server metrics (e.g. request count, request duration, etc.)
* HTTP request metrics (e.g. request count, request duration, etc.)
* [Hystrix-go] circuit breaker metrics (e.g. request count, request duration, etc.) powered by [Hystrix Prometheus]

## How to Add Custom Metrics

You can add custom metrics to your service by using the [Prometheus Go client library] and registering them with the default Prometheus registry. For example:

```go
package main

import (
    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promauto"
)

var (
    myCounter = promauto.NewCounter(prometheus.CounterOpts{
        Name: "my_counter",
        Help: "The total number of processed events",
    })
)

func myFunction() {
    ...
    myCounter.Inc()
    ...
}
```

These metrics will be automatically collected and exposed by Coldbrew on the `/metrics` endpoint.

{: .note .note-info }
To learn more about the Prometheus and the data types it supports, see [here](https://prometheus.io/docs/concepts/metric_types/)

## How to use Hystrix Metrics in Prometheus

{: .warning }
Hystrix-Go is unmaintained (last updated 2018). Consider migrating to [failsafe-go](https://github.com/failsafe-go/failsafe-go) for circuit breaker functionality.

[Hystrix Prometheus] is a library that provides a Prometheus metrics collector for [Hystrix-go]. To use it, you can register the collector with the default Prometheus registry:

```go

import (
    metricCollector "github.com/afex/hystrix-go/hystrix/metric_collector"
    "github.com/go-coldbrew/hystrixprometheus"
    "github.com/prometheus/client_golang/prometheus"
)

// setupHystrix sets up the hystrix metrics
// This is a workaround for hystrix-go not supporting the prometheus registry
func setupHystrix() {
	promC := hystrixprometheus.NewPrometheusCollector("hystrix", nil, prometheus.DefBuckets)
	metricCollector.Registry.Register(promC.Collector)
}
```

{: .note .note-info }
If you are using the `go-coldbrew/core` package, you can skip the above step as it will automatically register the collector for you.
See [Hystrix Prometheus] for more details.

---
[HTTP port]: https://pkg.go.dev/github.com/go-coldbrew/core/config#readme-type-config
[Hystrix Prometheus]: https://pkg.go.dev/github.com/go-coldbrew/hystrixprometheus
[Hystrix-go]: https://github.com/afex/hystrix-go
[Prometheus Go client library]: https://github.com/prometheus/client_golang
