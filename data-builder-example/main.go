package main

import (
	"context"
	"fmt"

	builder "github.com/go-coldbrew/data-builder"
)

var (
	b builder.DataBuilder
	p builder.Plan
)

type AppRequest struct {
	Cart []Item
}

type Item struct {
	Name         string
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
	return AppResponse{PriceInDollars: float64(grossPrice.InCents-priceAdjustment.DiscountInCents) / 100}, nil
}

func main() {
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

	err = builder.BuildGraph(p, "svg", "../assets/images/data-builder.svg")
	if err != nil {
		panic(err)
	}

	result, err := p.Run(
		context.Background(),
		AppRequest{
			Cart: []Item{
				Item{Name: "item1", PriceInCents: 1000},
				Item{Name: "item2", PriceInCents: 2000},
			},
		},
	)
	if err != nil {
		panic(err)
	}
	// read the values from the result
	resp := AppResponse{}
	resp = result.Get(resp).(AppResponse)
	fmt.Println("resp.PriceInDollars:", resp.PriceInDollars)
}
