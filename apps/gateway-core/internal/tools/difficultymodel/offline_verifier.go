package difficultymodel

const OfflineValidationReportSchemaVersion = "gatelm.difficulty-artifact-validation-report.v1"

type OfflineValidationComponentReport struct {
	Version string `json:"version"`
	Hash    string `json:"hash"`
}

type OfflineValidationComponentsReport struct {
	RuleVector    OfflineValidationComponentReport `json:"ruleVector"`
	Tokenizer     OfflineValidationComponentReport `json:"tokenizer"`
	Encoder       OfflineValidationComponentReport `json:"encoder"`
	Projection    OfflineValidationComponentReport `json:"projection"`
	SemanticHeads OfflineValidationComponentReport `json:"semanticHeads"`
}

type OfflineValidationReport struct {
	SchemaVersion              string                             `json:"schemaVersion"`
	Status                     string                             `json:"status"`
	FailureCode                string                             `json:"failureCode,omitempty"`
	ArtifactVersion            string                             `json:"artifactVersion,omitempty"`
	ContentHash                string                             `json:"contentHash,omitempty"`
	OfflineFeatureShapeVersion string                             `json:"offlineFeatureShapeVersion,omitempty"`
	CandidateName              string                             `json:"candidateName,omitempty"`
	TotalDimension             int                                `json:"totalDimension,omitempty"`
	PreprocessingVersion       string                             `json:"preprocessingVersion,omitempty"`
	Components                 *OfflineValidationComponentsReport `json:"components,omitempty"`
	BundleVersion              string                             `json:"bundleVersion,omitempty"`
	BundleHash                 string                             `json:"bundleHash,omitempty"`
	TrainingDatasetVersion     string                             `json:"trainingDatasetVersion,omitempty"`
	TrainingDatasetSHA256      string                             `json:"trainingDatasetSha256,omitempty"`
	SplitPolicyVersion         string                             `json:"splitPolicyVersion,omitempty"`
	SplitManifestSHA256        string                             `json:"splitManifestSha256,omitempty"`
	TrainingPolicyVersion      string                             `json:"trainingPolicyVersion,omitempty"`
}

func InvalidOfflineValidationReport(code string) OfflineValidationReport {
	return OfflineValidationReport{
		SchemaVersion: OfflineValidationReportSchemaVersion,
		Status:        "invalid",
		FailureCode:   code,
	}
}

func VerifyOfflineArtifactPayload(payload []byte) OfflineValidationReport {
	artifact, err := ParseOfflineArtifact(payload)
	if err != nil {
		return InvalidOfflineValidationReport("artifact_invalid")
	}
	return OfflineValidationReport{
		SchemaVersion:              OfflineValidationReportSchemaVersion,
		Status:                     "valid",
		ArtifactVersion:            artifact.ArtifactVersion,
		ContentHash:                artifact.ContentHash,
		OfflineFeatureShapeVersion: artifact.OfflineFeatureShapeVersion,
		CandidateName:              artifact.CandidateName,
		TotalDimension:             artifact.TotalDimension,
		PreprocessingVersion:       artifact.PreprocessingVersion,
		Components: &OfflineValidationComponentsReport{
			RuleVector: OfflineValidationComponentReport{
				Version: artifact.RuleVectorVersion,
				Hash:    artifact.ComponentHashes.RuleVector,
			},
			Tokenizer: OfflineValidationComponentReport{
				Version: artifact.TokenizerVersion,
				Hash:    artifact.ComponentHashes.Tokenizer,
			},
			Encoder: OfflineValidationComponentReport{
				Version: artifact.EncoderVersion,
				Hash:    artifact.ComponentHashes.Encoder,
			},
			Projection: OfflineValidationComponentReport{
				Version: artifact.ProjectionVersion,
				Hash:    artifact.ComponentHashes.Projection,
			},
			SemanticHeads: OfflineValidationComponentReport{
				Version: artifact.SemanticHeadsVersion,
				Hash:    artifact.ComponentHashes.SemanticHeads,
			},
		},
		BundleVersion:          artifact.BundleVersion,
		BundleHash:             artifact.BundleHash,
		TrainingDatasetVersion: artifact.TrainingDatasetVersion,
		TrainingDatasetSHA256:  artifact.TrainingDatasetSHA256,
		SplitPolicyVersion:     artifact.SplitPolicyVersion,
		SplitManifestSHA256:    artifact.SplitManifestSHA256,
		TrainingPolicyVersion:  artifact.TrainingPolicyVersion,
	}
}
