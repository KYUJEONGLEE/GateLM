package httpclient

import (
	"net/http"
	"testing"
	"time"
)

func TestNewBuildsBoundedReusableProviderTransport(t *testing.T) {
	cfg := Config{
		RequestTimeout:        60 * time.Second,
		MaxIdleConns:          512,
		MaxIdleConnsPerHost:   256,
		MaxConnsPerHost:       256,
		IdleConnTimeout:       90 * time.Second,
		DialTimeout:           5 * time.Second,
		DialKeepAlive:         30 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 60 * time.Second,
		ExpectContinueTimeout: time.Second,
	}
	client := New(cfg)

	if client.Timeout != cfg.RequestTimeout {
		t.Fatalf("unexpected request timeout: %s", client.Timeout)
	}
	transport, ok := client.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("expected *http.Transport, got %T", client.Transport)
	}
	if transport == http.DefaultTransport {
		t.Fatal("provider transport must clone rather than mutate http.DefaultTransport")
	}
	if transport.MaxIdleConns != 512 || transport.MaxIdleConnsPerHost != 256 || transport.MaxConnsPerHost != 256 {
		t.Fatalf("unexpected connection limits: totalIdle=%d hostIdle=%d hostMax=%d", transport.MaxIdleConns, transport.MaxIdleConnsPerHost, transport.MaxConnsPerHost)
	}
	if transport.IdleConnTimeout != 90*time.Second || transport.ResponseHeaderTimeout != 60*time.Second {
		t.Fatalf("unexpected transport timeouts: idle=%s responseHeader=%s", transport.IdleConnTimeout, transport.ResponseHeaderTimeout)
	}
	if transport.DialContext == nil || !transport.ForceAttemptHTTP2 {
		t.Fatal("provider transport must configure dial keepalive and HTTP/2 negotiation")
	}
}
