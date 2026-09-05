FROM golang:1.22-alpine AS builder

WORKDIR /app

COPY go.mod go.sum* ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /havoc-api ./cmd/havoc-api

FROM alpine:3.20

COPY --from=builder /havoc-api /havoc-api

EXPOSE 8080
ENTRYPOINT ["/havoc-api"]
