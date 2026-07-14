package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"gatelm/apps/gateway-core/internal/tools/difficultymodel"
)

func main() {
	artifactPath := flag.String("artifact", "", "versioned difficulty model artifact JSON")
	outputPath := flag.String("output", "", "generated Go output; use a temporary candidate path before promotion")
	flag.Parse()
	if *artifactPath == "" || *outputPath == "" {
		fmt.Fprintln(os.Stderr, "-artifact and -output are required")
		os.Exit(2)
	}
	payload, err := os.ReadFile(*artifactPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, "read model artifact:", err)
		os.Exit(1)
	}
	generated, err := difficultymodel.RenderArtifactPayload(payload, "routing")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err := os.MkdirAll(filepath.Dir(*outputPath), 0o755); err != nil {
		fmt.Fprintln(os.Stderr, "create generated output directory:", err)
		os.Exit(1)
	}
	if err := os.WriteFile(*outputPath, generated, 0o644); err != nil {
		fmt.Fprintln(os.Stderr, "write generated Go model:", err)
		os.Exit(1)
	}
}
