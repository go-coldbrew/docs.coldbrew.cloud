---
layout: default
title: "Data Builder"
parent: "How To"
description: "How to use go-coldbrew/data-builder package to orchestrate data-processing logic in Go."
---
## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

## Overview

Most web services receive data in a request, process that data in multiple steps, and return a response that depends on the output of these steps. [data-builder] is a library designed to compile and execute this type of data-processing logic.

## Usage

### Declare data structures

The library resolves the dependencies between data builder functions by looking at the input and output types of each function. The input and output types must be structs. So we first need to declare go structs to contain the initial and built data.

Suppose our app calculates the total price of a shopping cart including discounts. The input data is a list of items in the cart, and the output data is the total price after discounts. We might declare the structs as follows:

```go
type AppRequest struct {
    Cart []Item
}

type Item struct {
    Name  string
    PriceInCents int64
}

type GrossPrice struct {
    InCents int64
}

type PriceAdjustment struct {
    DiscountInCents int64
}

type AppResponse struct {
    PriceInDollars float64
}
```

In practice, computation graphs can be much more complex than this example and a large number structs may be required. Code generation is often used to manage this. For example, go generate can be used to declare structs that embed a common underlying data structure and implement a common interface. If you are not familiar with code generation in go, this [guide to go generate] is a good place to start.


### Defining the builder function

Users can express any data-processing logic as functions that accept and return structs. In our example, we need functions to build three data structures: the gross price, price adjustments and the final response:

```go
func BuildGrossPrice(_ context.Context, req AppRequest) (GrossPrice, error) {
    var grossPrice int64
    for _, item := range req.Cart {
        grossPrice += item.PriceInCents
    }
    return GrossPrice{InCents: grossPrice}, nil
}

func BuildPriceAdjustment(_ context.Context, grossPrice GrossPrice) (PriceAdjustment, error) {
    var discount int64
    if grossPrice.InCents > 10000 {
        discount = 1000
    }
    return PriceAdjustment{DiscountInCents: discount}, nil
}

func BuildAppResponse(_ context.Context, grossPrice GrossPrice, priceAdjustment PriceAdjustment) (AppResponse, error) {
    return AppResponse{PriceInDollars: float64(grossPrice.InCents - priceAdjustment.DiscountInCents) / 100}, nil
}
```

Note that the builder function signatures must satisfy the following requirements:
1. The first argument is a context.Context
2. All subsequent arguments are stucts
3. There are two return values: a struct and an error


### Compiling an execution plan

Now that we have defined the builder functions, we can compile an execution plan. The library will automatically resolve the dependencies between the builder functions and determine the order of execution.

```go

import builder "github.com/go-coldbrew/data-builder"

var (
    b builder.DataBuilder
    p builder.Plan
)

func init() {

    b = builder.New()
    err := b.AddBuilders(
        BuildGrossPrice,
        BuildPriceAdjustment,
        BuildAppResponse,
    )
    if err != nil {
        panic(err)
    }
    // When compiling the execution plan we need to tell the library that we will provide
    // it some initial data. We do that by passing empty structs since the compiler
    // just needs the type, values will come in later when we run the plan.
    p, err = b.Compile(AppRequest{})
    if err != nil {
        panic(err)
    }
}
```

How does dependency resolution work? We defined a function called `BuildPriceAdjustment`. This function takes `GrossPrice` as an argument. This tells the library that this function depends on this object. The function also returns `PriceAdjustment`, which tells the library that this function needs to be executed for any other function that depends on `PriceAdjustment`.

During compilation we resolve all dependencies and build an execution plan. Note we have compiled the plan in our package's init function. This means the service won't start in case there are issues in dependency resolution. This allows us to catch these issues in testing.

After compilation we can also inspect the dependency graph visually by calling `BuildGraph`:

![dependency graph](../../assets/images/data-builder.svg)

### Running the execution plan and retrieving the results

Now we're ready to run the execution plan using some actual input data:

```go
// execute the plan
result, err := p.Run(
    context.Background(),
    AppRequest{
        Cart: []Item{
            Item{Name: "item1", PriceInCents: 1000},
            Item{Name: "item2", PriceInCents: 2000},
        },
    },
)
// read the values from the result
resp := AppResponse{}
resp = result.Get(resp).(AppResponse)
fmt.Println(resp.PriceInDollars)
```

### Replacing builders at runtime

The `Replace` method allows you to swap out a builder function at runtime. This is useful for testing or when you need to change behavior without recompiling the plan.

```go
// Define a mock builder for testing
func MockBuildPriceAdjustment(_ context.Context, grossPrice GrossPrice) (PriceAdjustment, error) {
    // Always return a fixed discount for testing
    return PriceAdjustment{DiscountInCents: 500}, nil
}

// Replace the builder with the mock
err := p.Replace(context.Background(), BuildPriceAdjustment, MockBuildPriceAdjustment)
if err != nil {
    panic(err)
}

// Run with the replaced builder
result, err := p.Run(context.Background(), AppRequest{...})
```

{: .note}
The replacement function must have the same input and output types as the original.

### Running plans in parallel

For I/O-bound operations, you can run the plan with parallel execution using `RunParallel`:

```go
// Run with up to 4 parallel goroutines
result, err := p.RunParallel(
    context.Background(),
    4,  // max parallelism
    AppRequest{
        Cart: []Item{
            Item{Name: "item1", PriceInCents: 1000},
            Item{Name: "item2", PriceInCents: 2000},
        },
    },
)
```

{: .important}
Parallel execution is beneficial for I/O-bound builders (network calls, database queries). For CPU-bound operations, the overhead may outweigh the benefits.

---
[data-builder]: https://pkg.go.dev/github.com/go-coldbrew/data-builder
[guide to go generate]: https://eli.thegreenplace.net/2021/a-comprehensive-guide-to-go-generate/
