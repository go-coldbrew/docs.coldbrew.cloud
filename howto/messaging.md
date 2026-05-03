---
layout: default
title: "Messaging"
parent: "How To"
nav_order: 24
description: "How to run Kafka or NATS consumers in a ColdBrew service via workers.Worker, with graceful drain on shutdown and built-in tracing"
---
# Messaging

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

ColdBrew is broker-agnostic — `core` does not import a Kafka or NATS client. Consumers run as long-lived workers via the [workers package](/howto/workers), so the framework already handles startup, panic recovery, restart, metrics, and the graceful drain on shutdown. You bring the client; ColdBrew runs it.

This page shows the framework pattern and Kafka and NATS examples. The same shape works for any subscription-style broker — Pub/Sub, RabbitMQ, SQS — swap the client.

## The pattern

A messaging consumer is a long-running worker:

```
CBWorkerProvider.Workers() returns one *workers.Worker per subscription.
Each worker:
  - opens its broker client
  - reads in a loop, handling each message
  - returns when ctx.Done() fires
  - returns ctx.Err() so core treats it as a clean shutdown
```

Two interfaces from `go-coldbrew/core` and one helper from `go-coldbrew/workers` carry the work:

- [`CBWorkerProvider.Workers() []*workers.Worker`](https://pkg.go.dev/github.com/go-coldbrew/core#CBWorkerProvider) — implement this on your service to register workers.
- [`workers.NewWorker(name).HandlerFunc(fn)`](https://pkg.go.dev/github.com/go-coldbrew/workers#NewWorker) — build a worker from a function with signature `func(ctx context.Context, info *workers.WorkerInfo) error`.
- [`CBPreStopper.PreStop(ctx)`](https://pkg.go.dev/github.com/go-coldbrew/core#CBPreStopper) — optional; runs *before* the worker context is cancelled. Use it to deregister from the broker or pause new work without dropping in-flight messages.

When core shuts down, it cancels the worker context (step 4 in the [shutdown sequence](/howto/signals#graceful-shutdown)). Your handler sees `ctx.Done()` close, finishes the in-flight message, and returns `ctx.Err()`. Core waits for that return before stopping the gRPC server, so a slow consumer drains cleanly.

See [Workers how-to](/howto/workers) for the full worker API (middleware, jitter, restart-on-fail, child workers, metrics).

## Kafka with kafka-go

Start the Kafka container:

```bash
make local-stack PROFILES=kafka
```

The cookiecutter `docker-compose.local.yml` exposes Kafka at `localhost:9092` under the `kafka` profile.

Add the broker fields to your `config/config.go` so they're loaded the same way as the rest of your config:

```go
// config/config.go
type Config struct {
    cbConfig.Config
    auth.AuthConfig

    KafkaBrokers []string `envconfig:"KAFKA_BROKERS" required:"true"`
    KafkaTopic   string   `envconfig:"KAFKA_TOPIC" required:"true"`
    KafkaGroupID string   `envconfig:"KAFKA_GROUP_ID" required:"true"`
}
```

Then set the values like any other env var:

```bash
export KAFKA_BROKERS=localhost:9092
export KAFKA_TOPIC=events
export KAFKA_GROUP_ID=my-service
```

[segmentio/kafka-go] is a pure-Go client with a context-aware reader API that fits the worker pattern naturally:

```go
package svc

import (
    "context"
    "errors"
    "io"
    "time"

    "github.com/go-coldbrew/core"
    "github.com/go-coldbrew/log"
    "github.com/go-coldbrew/tracing"
    "github.com/go-coldbrew/workers"
    "github.com/segmentio/kafka-go"

    "myapp/config" // import path of your service's config package
)

type Service struct {
    // … your other fields
}

var _ core.CBWorkerProvider = (*Service)(nil)

func (s *Service) Workers() []*workers.Worker {
    return []*workers.Worker{
        workers.NewWorker("kafka-events").HandlerFunc(s.consumeEvents),
    }
}

func (s *Service) consumeEvents(ctx context.Context, info *workers.WorkerInfo) error {
    cfg := config.Get()
    reader := kafka.NewReader(kafka.ReaderConfig{
        Brokers:        cfg.KafkaBrokers,
        Topic:          cfg.KafkaTopic,
        GroupID:        cfg.KafkaGroupID,
        MinBytes:       1,
        MaxBytes:       10 << 20, // 10 MB
        CommitInterval: time.Second,
    })
    defer reader.Close()

    for {
        msg, err := reader.ReadMessage(ctx)
        if err != nil {
            // Context cancellation is the expected shutdown signal.
            if errors.Is(err, context.Canceled) || errors.Is(err, io.EOF) {
                return ctx.Err()
            }
            log.GetLogger(ctx).Error("kafka read", "err", err)
            return err // worker will restart by default
        }
        if err := s.handleEvent(ctx, msg); err != nil {
            // Decide: log-and-continue (at-least-once with poison-pill risk),
            // or return the error to trigger a restart.
            log.GetLogger(ctx).Error("handle event", "err", err, "offset", msg.Offset)
        }
    }
}

func (s *Service) handleEvent(ctx context.Context, msg kafka.Message) error {
    span, ctx := tracing.NewInternalSpan(ctx, "handleEvent")
    defer span.End()
    span.SetTag("kafka.topic", msg.Topic)
    span.SetTag("kafka.partition", msg.Partition)
    span.SetTag("kafka.offset", msg.Offset)

    // … your business logic on msg.Value
    return nil
}
```

The shape of the loop is the important part:

- **`ReadMessage(ctx)` is the cancellation point.** When core cancels `ctx`, `ReadMessage` returns immediately and the handler returns `ctx.Err()` — a clean drain.
- **Handler errors are a policy choice.** Returning the error restarts the worker (and re-reads the same offset, since `kafka-go` only commits successful work). Logging and continuing skips the message but keeps the consumer alive — fine for non-critical events, dangerous for anything you must process.
- **Per-message tracing uses `NewInternalSpan`.** The span has no parent gRPC trace, so it starts a fresh trace per message; tag the topic/partition/offset so you can correlate with broker-side logs.

## NATS with nats.go

Start the NATS container:

```bash
make local-stack PROFILES=nats
```

NATS exposes port `4222` under the `nats` profile. Add the connection field to `config/config.go`:

```go
// config/config.go
type Config struct {
    cbConfig.Config
    auth.AuthConfig

    NATSURL     string `envconfig:"NATS_URL" required:"true"`
    NATSSubject string `envconfig:"NATS_SUBJECT" required:"true"`
    NATSQueue   string `envconfig:"NATS_QUEUE" required:"true"`
}
```

Then export the values:

```bash
export NATS_URL=nats://localhost:4222
export NATS_SUBJECT=orders.created
export NATS_QUEUE=my-service
```

The official client [nats-io/nats.go] uses a callback-style subscription, which is a slightly different worker shape — the worker exists to keep the subscription alive and to drain on shutdown, while the callback runs each message:

```go
package svc

import (
    "context"
    "fmt"

    "github.com/go-coldbrew/core"
    "github.com/go-coldbrew/log"
    "github.com/go-coldbrew/tracing"
    "github.com/go-coldbrew/workers"
    "github.com/nats-io/nats.go"

    "myapp/config" // import path of your service's config package
)

type Service struct {
    nc *nats.Conn
}

var (
    _ core.CBWorkerProvider = (*Service)(nil)
    _ core.CBPreStarter     = (*Service)(nil)
    _ core.CBStopper        = (*Service)(nil)
)

func (s *Service) PreStart(ctx context.Context) error {
    nc, err := nats.Connect(config.Get().NATSURL)
    if err != nil {
        return fmt.Errorf("nats connect: %w", err)
    }
    s.nc = nc
    return nil
}

func (s *Service) Stop() {
    if s.nc != nil {
        // Drain blocks until in-flight callbacks finish.
        _ = s.nc.Drain()
    }
}

func (s *Service) Workers() []*workers.Worker {
    return []*workers.Worker{
        workers.NewWorker("nats-orders").HandlerFunc(s.consumeOrders),
    }
}

func (s *Service) consumeOrders(ctx context.Context, info *workers.WorkerInfo) error {
    cfg := config.Get()
    sub, err := s.nc.QueueSubscribe(cfg.NATSSubject, cfg.NATSQueue, func(m *nats.Msg) {
        s.handleOrder(ctx, m)
    })
    if err != nil {
        return err
    }
    defer sub.Unsubscribe()

    <-ctx.Done() // block until shutdown
    return ctx.Err()
}

func (s *Service) handleOrder(ctx context.Context, m *nats.Msg) {
    span, ctx := tracing.NewInternalSpan(ctx, "handleOrder")
    defer span.End()
    span.SetTag("nats.subject", m.Subject)

    // … your business logic on m.Data
}
```

Notice the split:

- **`PreStart` opens the connection** so the service fails fast if NATS is unreachable.
- **`Stop()` calls `Drain()`**, which stops accepting new messages but waits for in-flight callbacks to finish — this is the NATS equivalent of "graceful shutdown."
- **The worker exists to hold the subscription open** until `ctx.Done()`, then unsubscribes. `Drain()` in `Stop()` then handles the in-flight callbacks.

## Tracing across the broker boundary

The two examples above start a fresh trace per message because the publisher and consumer are usually separate services and broker messages don't carry trace context by default. You have two options for correlating producer and consumer:

- **Inject the trace ID into message metadata.** Kafka has headers; NATS has `nats.Msg.Header`; both let you propagate a `trace-id` you can read on the consumer side and use as the parent span. Most tracing backends (OTLP-compatible, New Relic) understand this if you use the standard W3C `traceparent` header name.
- **Treat consumer and producer as separate traces, link by domain ID.** Tag both spans with the same business identifier (order ID, user ID) and rely on log correlation. Simpler, less precise.

For most internal services, the second option is good enough; reach for trace-context propagation when you need to debug a specific cross-broker latency problem.

## Shutdown and at-least-once delivery

The default worker behaviour gives you **at-least-once** delivery: a message that is read but not yet acknowledged when shutdown begins will be redelivered on the next consumer (Kafka commits offsets, NATS replays unacked messages on a JetStream consumer, etc.).

Two operational consequences:

- **Make handlers idempotent.** A duplicate message during a rolling deploy is normal, not a bug.
- **Tune `SHUTDOWN_DURATION_IN_SECONDS` to allow drain.** The default is 15s. If your handler's tail latency is longer than that, increase the shutdown duration or the per-message work won't finish before SIGKILL. See [Production Deployment — Graceful shutdown tuning](/howto/production#graceful-shutdown-tuning).

## Local stack profiles

| Profile | Service | Port |
|---|---|---|
| `kafka` | Kafka (KRaft, no ZK) | 9092 |
| `nats` | NATS | 4222 |

See [Local Development](/howto/local-dev) for the full list, including `pubsub` (Google Pub/Sub emulator) which follows the same worker pattern.

## Related

- [Workers](/howto/workers) — Full worker API: middleware, jitter, restart, metrics, child workers.
- [Readiness Patterns](/howto/readiness) — Combining workers with `/readycheck` so the service only reports ready once consumers are subscribed.
- [Tracing](/howto/Tracing) — Internal spans and trace propagation.
- [Shutdown Lifecycle](/howto/signals) — Where worker drain fits in the broader shutdown sequence.

[segmentio/kafka-go]: https://github.com/segmentio/kafka-go
[nats-io/nats.go]: https://github.com/nats-io/nats.go
