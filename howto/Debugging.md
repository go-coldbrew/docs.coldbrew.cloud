---
layout: default
title: "Debugging"
parent: "How To"
description: "Debugging ColdBrew services with pprof and log overrides"
---
## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

## pprof

Golang provides a built-in profiler called [pprof](https://golang.org/pkg/net/http/pprof/). It is a tool that can be used to collect CPU and memory profiles. It can be used to collect profiles from a running application and then analyze them to find the root cause of performance issues.

ColdBrew exposes `/debug/pprof/` endpoint on the HTTP port that can be used to collect profiles. The endpoint is only available when the [configuration option] `DisableDebug` is set to `false` (which is the default behaviour).

### Collecting profiles

To collect a profile, you can use the `go tool pprof` command. For example, to collect a CPU profile, you can run the following command:

```bash
$ go tool pprof http://localhost:9091/debug/pprof/profile
```

This will open an interactive shell where you can run commands to analyze the profile. For example, to see the top 10 functions that are consuming the most CPU, you can run the following command:

```bash
(pprof) top5
Showing nodes accounting for 30ms, 100% of 30ms total
Showing top 5 nodes out of 45
      flat  flat%   sum%        cum   cum%
      20ms 66.67% 66.67%       20ms 66.67%  runtime.memclrNoHeapPointers
      10ms 33.33%   100%       10ms 33.33%  syscall.syscall
         0     0%   100%       20ms 66.67%  github.com/NYTimes/gziphandler.GzipHandlerWithOpts.func1.1
         0     0%   100%       10ms 33.33%  github.com/ankurs/MyApp/proto.(*mySvcClient).Echo
         0     0%   100%       20ms 66.67%  github.com/ankurs/MyApp/proto.RegisterMySvcHandlerClient.func3
```

### Analyzing profiles

The `go tool pprof` command can be  also be used to analyze profiles to find the root cause of performance issues. For more information, please refer to the [pprof walkthrough] and the [diagnostics doc].

{: .important }
Its recommended that you go though the [pprof walkthrough] to get a better understanding of how to use the pprof.

### Disabling pprof endpoint

The pprof endpoint can be disabled by setting the [configuration option] `DisableDebug` or the environment variable `DISABLE_DEBUG` to `true`. This is useful if you want to disable the `/debug/pprof/` endpoint in production.

{: .note .note-info }
Its recommended to only expose the endpoint that are used by clients, and disable the rest of the endpoints at the load balancer level by using a whitelist.

## Overriding log level at request time

ColdBrew provides a way to override the log level of a request based on the request parameters. This can be useful when you want to log a request at a different log level than the default log level. For example, you can log a request at the `debug` log level when a `debug` query parameter is present in the request.

For information on this feature, please refer to the [Overriding log level at request time] page.

---
[configuration option]: https://pkg.go.dev/github.com/go-coldbrew/core/config#Config
[Overriding log level at request time]: /howto/Log/#overriding-log-level-at-request-time
[diagnostics doc]: https://go.dev/doc/diagnostics#profiling
[pprof walkthrough]: https://go.dev/blog/pprof
