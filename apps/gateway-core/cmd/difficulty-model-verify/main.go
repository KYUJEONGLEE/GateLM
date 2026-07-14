package main

import (
	"encoding/json"
	"flag"
	"io"
	"os"
	"path/filepath"

	"gatelm/apps/gateway-core/internal/tools/difficultymodel"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout))
}

func run(args []string, stdout io.Writer) int {
	flags := flag.NewFlagSet("difficulty-model-verify", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	artifactPath := flags.String("artifact", "", "offline difficulty model artifact JSON")
	reportPath := flags.String("report", "", "optional safe validation report JSON")
	if err := flags.Parse(args); err != nil || *artifactPath == "" {
		return writeReport(stdout, *reportPath, difficultymodel.InvalidOfflineValidationReport("invalid_arguments"), 2)
	}
	payload, err := os.ReadFile(*artifactPath)
	if err != nil {
		return writeReport(stdout, *reportPath, difficultymodel.InvalidOfflineValidationReport("artifact_read_failed"), 1)
	}
	report := difficultymodel.VerifyOfflineArtifactPayload(payload)
	exitCode := 0
	if report.Status != "valid" {
		exitCode = 1
	}
	return writeReport(stdout, *reportPath, report, exitCode)
}

func writeReport(stdout io.Writer, reportPath string, report difficultymodel.OfflineValidationReport, exitCode int) int {
	payload, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return 1
	}
	payload = append(payload, '\n')
	if reportPath == "" {
		if _, err := stdout.Write(payload); err != nil {
			return 1
		}
		return exitCode
	}
	if err := os.MkdirAll(filepath.Dir(reportPath), 0o755); err != nil {
		fallback, _ := json.Marshal(difficultymodel.InvalidOfflineValidationReport("report_write_failed"))
		_, _ = stdout.Write(append(fallback, '\n'))
		return 1
	}
	if err := os.WriteFile(reportPath, payload, 0o644); err != nil {
		fallback, _ := json.Marshal(difficultymodel.InvalidOfflineValidationReport("report_write_failed"))
		_, _ = stdout.Write(append(fallback, '\n'))
		return 1
	}
	return exitCode
}
