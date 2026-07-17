package tenantchat

import (
	"strings"
	"testing"
)

func TestValidateCompletionInputAllowsOnlySystemRagContextPurpose(t *testing.T) {
	if err := ValidateCompletionInput(CompletionInput{Stream: true, Messages: []EphemeralMessage{
		{Role: "system", Purpose: "rag_context", Content: "untrusted source block"},
		{Role: "user", Content: "question"},
	}}); err != nil {
		t.Fatalf("expected rag context marker to be accepted: %v", err)
	}

	if err := ValidateCompletionInput(CompletionInput{Stream: true, Messages: []EphemeralMessage{
		{Role: "user", Purpose: "rag_context", Content: "question"},
	}}); err == nil {
		t.Fatal("expected non-system rag context marker to be rejected")
	}
}

func TestValidateCompletionInputUsesSeparateRAGContextSizeLimit(t *testing.T) {
	if err := ValidateCompletionInput(CompletionInput{Stream: true, Messages: []EphemeralMessage{
		{Role: "system", Purpose: "rag_context", Content: strings.Repeat("r", 30_000)},
		{Role: "user", Content: "question"},
	}}); err != nil {
		t.Fatalf("expected request-local RAG context above the public message limit to be accepted: %v", err)
	}

	if err := ValidateCompletionInput(CompletionInput{Stream: true, Messages: []EphemeralMessage{
		{Role: "system", Content: strings.Repeat("x", maxEphemeralMessageRunes+1)},
	}}); err == nil {
		t.Fatal("expected an oversized non-RAG message to be rejected")
	}

	if err := ValidateCompletionInput(CompletionInput{Stream: true, Messages: []EphemeralMessage{
		{Role: "system", Purpose: "rag_context", Content: strings.Repeat("r", maxRAGContextMessageRunes+1)},
	}}); err == nil {
		t.Fatal("expected an oversized RAG context message to be rejected")
	}
}
