package httpclient

import (
	"net"
	"net/http"
	"time"
)

type Config struct {
	MaxIdleConns          int
	MaxIdleConnsPerHost   int
	MaxConnsPerHost       int
	IdleConnTimeout       time.Duration
	DialTimeout           time.Duration
	DialKeepAlive         time.Duration
	TLSHandshakeTimeout   time.Duration
	ResponseHeaderTimeout time.Duration
	ExpectContinueTimeout time.Duration
}

func New(cfg Config) *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.MaxIdleConns = cfg.MaxIdleConns
	transport.MaxIdleConnsPerHost = cfg.MaxIdleConnsPerHost
	transport.MaxConnsPerHost = cfg.MaxConnsPerHost
	transport.IdleConnTimeout = cfg.IdleConnTimeout
	transport.TLSHandshakeTimeout = cfg.TLSHandshakeTimeout
	transport.ResponseHeaderTimeout = cfg.ResponseHeaderTimeout
	transport.ExpectContinueTimeout = cfg.ExpectContinueTimeout
	transport.ForceAttemptHTTP2 = true
	transport.DialContext = (&net.Dialer{
		Timeout:   cfg.DialTimeout,
		KeepAlive: cfg.DialKeepAlive,
	}).DialContext

	// Provider adapters apply each runtime target's deadline to the request
	// context. A client-wide timeout here would override that deadline.
	return &http.Client{
		Transport: transport,
	}
}
