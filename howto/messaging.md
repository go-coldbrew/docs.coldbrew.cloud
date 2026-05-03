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

```text
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

## Kafka with sarama

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

[IBM/sarama] is the most widely deployed Kafka client for Go. Its consumer-group API requires a small `ConsumerGroupHandler` adapter but gives you at-least-once semantics by default — `MarkMessage` only after the handler succeeds:

```go
package svc

import (
    "context"
    "errors"
    "fmt"

    "github.com/IBM/sarama"
    "github.com/go-coldbrew/core"
    "github.com/go-coldbrew/log"
    "github.com/go-coldbrew/tracing"
    "github.com/go-coldbrew/workers"

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
    saramaCfg := sarama.NewConfig()
    saramaCfg.Version = sarama.V3_6_0_0
    // Auto-commit is on by default with a 1s interval. Marked offsets are
    // committed at most ~1s after MarkMessage; a crash inside that window
    // replays at most ~1s of work. For strictest at-least-once, set
    // saramaCfg.Consumer.Offsets.AutoCommit.Enable = false and call
    // sess.Commit() after MarkMessage.

    group, err := sarama.NewConsumerGroup(cfg.KafkaBrokers, cfg.KafkaGroupID, saramaCfg)
    if err != nil {
        return fmt.Errorf("kafka consumer group: %w", err)
    }
    defer group.Close()

    handler := &consumerGroupHandler{svc: s}
    for {
        // Consume blocks until the session ends (rebalance, error, or ctx cancellation),
        // then we re-enter so the group rejoins after a rebalance.
        if err := group.Consume(ctx, []string{cfg.KafkaTopic}, handler); err != nil {
            if errors.Is(err, sarama.ErrClosedConsumerGroup) {
                return ctx.Err()
            }
            log.GetLogger(ctx).Error("kafka consume", "err", err)
            return err
        }
        if ctx.Err() != nil {
            return ctx.Err()
        }
    }
}

type consumerGroupHandler struct {
    svc *Service
}

func (h *consumerGroupHandler) Setup(sarama.ConsumerGroupSession) error   { return nil }
func (h *consumerGroupHandler) Cleanup(sarama.ConsumerGroupSession) error { return nil }

func (h *consumerGroupHandler) ConsumeClaim(sess sarama.ConsumerGroupSession, claim sarama.ConsumerGroupClaim) error {
    for {
        select {
        case <-sess.Context().Done():
            return nil
        case msg, ok := <-claim.Messages():
            if !ok {
                return nil // partition revoked or claim closed
            }
            if err := h.svc.handleEvent(sess.Context(), msg); err != nil {
                log.GetLogger(sess.Context()).Error("handle event", "err", err, "offset", msg.Offset)
                return err // session ends; group rebalances; message replays
            }
            sess.MarkMessage(msg, "")
        }
    }
}

func (s *Service) handleEvent(ctx context.Context, msg *sarama.ConsumerMessage) error {
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

- **Mark only after success is what makes it at-least-once.** `MarkMessage` advances the in-memory offset for the partition; the consumer group flushes marked offsets on the auto-commit interval (default 1s). Returning before `MarkMessage` means the message replays after the next rebalance — exactly the behaviour you want when a handler errors.
- **`sess.Context().Done()` is the cancellation point.** When core cancels the worker context, `group.Close()` ends the session and `sess.Context()` fires `Done()`; `ConsumeClaim` returns nil for a clean drain.
- **The outer `for { Consume; ... }` loop handles rebalances.** Each `Consume` call holds one session; rejoining the group requires re-entering. A non-rebalance error breaks out and returns the error so the worker restarts.
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

The official client [nats-io/nats.go] supports both callback-style subscriptions (`QueueSubscribe`) and channel-style (`ChanQueueSubscribe`). Channel-style fits the workers package directly via [`workers.ChannelWorker`](https://pkg.go.dev/github.com/go-coldbrew/workers#ChannelWorker), which already implements the `select { ctx.Done() / msgCh }` loop, error propagation, and clean drain on cancellation:

```go
package svc

import (
    "context"
    "fmt"

    "github.com/go-coldbrew/core"
    "github.com/go-coldbrew/tracing"
    "github.com/go-coldbrew/workers"
    "github.com/nats-io/nats.go"

    "myapp/config" // import path of your service's config package
)

type Service struct {
    nc    *nats.Conn
    msgCh chan *nats.Msg
}

var (
    _ core.CBWorkerProvider = (*Service)(nil)
    _ core.CBPreStarter     = (*Service)(nil)
    _ core.CBStopper        = (*Service)(nil)
)

func (s *Service) PreStart(ctx context.Context) error {
    cfg := config.Get()
    nc, err := nats.Connect(cfg.NATSURL)
    if err != nil {
        return fmt.Errorf("nats connect: %w", err)
    }

    // Buffered channel = explicit backpressure knob. Once full, NATS will
    // start dropping messages for the subscription unless you've enabled
    // JetStream flow control on the broker side.
    msgCh := make(chan *nats.Msg, 64)
    if _, err := nc.ChanQueueSubscribe(cfg.NATSSubject, cfg.NATSQueue, msgCh); err != nil {
        nc.Close() // don't leak the connection if the subscription failed
        return fmt.Errorf("nats subscribe: %w", err)
    }
    s.nc = nc
    s.msgCh = msgCh
    return nil
}

func (s *Service) Stop() {
    if s.nc != nil {
        // Drain stops accepting new messages and waits for the channel to empty.
        _ = s.nc.Drain()
    }
}

func (s *Service) Workers() []*workers.Worker {
    return []*workers.Worker{
        workers.NewWorker("nats-orders").HandlerFunc(
            workers.ChannelWorker(s.msgCh, s.handleOrder),
        ),
    }
}

func (s *Service) handleOrder(ctx context.Context, info *workers.WorkerInfo, m *nats.Msg) error {
    span, ctx := tracing.NewInternalSpan(ctx, "handleOrder")
    defer span.End()
    span.SetTag("nats.subject", m.Subject)

    // … your business logic on m.Data
    return nil
}
```

Notice the split:

- **`PreStart` opens the connection and registers the subscription.** Messages start landing in `s.msgCh` immediately; the worker hasn't started yet, but the buffered channel absorbs them.
- **`workers.ChannelWorker(s.msgCh, s.handleOrder)`** is the whole consumer loop — it reads the next message, calls your handler, returns the handler's error to restart the worker, and exits cleanly when `ctx.Done()` fires.
- **Consumption is independent of the wiring.** `handleOrder` takes only `(ctx, info, *nats.Msg)` and knows nothing about subscriptions, channels, or NATS lifecycle — you can unit-test it with a hand-built `*nats.Msg`, and the same handler shape would work behind any source that produces a `chan T` (an internal pipeline, a generated mock, a different broker). The channel is the seam.
- **`Stop()` calls `Drain()`**, which stops new messages and lets the channel empty before the connection closes.

For batch processing, swap `workers.ChannelWorker` for [`workers.BatchChannelWorker(ch, maxSize, maxDelay, fn)`](https://pkg.go.dev/github.com/go-coldbrew/workers#BatchChannelWorker) — same shape, but flushes batches by size or time, whichever comes first.

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

[IBM/sarama]: https://github.com/IBM/sarama
[nats-io/nats.go]: https://github.com/nats-io/nats.go
