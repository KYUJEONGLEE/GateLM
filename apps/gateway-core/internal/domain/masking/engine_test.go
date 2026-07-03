package masking

import (
	"context"
	"reflect"
	"strings"
	"testing"
)

func TestP0EngineRedactsEmailAndPhone(t *testing.T) {
	engine := NewP0Engine()

	result, err := engine.Apply(context.Background(), ApplyRequest{
		Prompt: "Contact user@example.invalid or 010-0000-0000.",
	})
	if err != nil {
		t.Fatalf("Apply returned error: %v", err)
	}

	if result.Action != ActionRedacted {
		t.Fatalf("expected redacted action, got %s", result.Action)
	}
	if !reflect.DeepEqual(result.DetectedTypes, []string{"email", "phone_number"}) {
		t.Fatalf("expected stable sorted detected types, got %#v", result.DetectedTypes)
	}
	if result.DetectedCount != 2 {
		t.Fatalf("expected detected count 2, got %d", result.DetectedCount)
	}
	if !strings.Contains(result.RedactedPrompt, "[EMAIL_1]") || !strings.Contains(result.RedactedPrompt, "[PHONE_NUMBER_1]") {
		t.Fatalf("expected placeholders in redacted prompt, got %q", result.RedactedPrompt)
	}
	if strings.Contains(result.RedactedPrompt, "user@example.invalid") || strings.Contains(result.RedactedPrompt, "010-0000-0000") {
		t.Fatalf("redacted prompt must not contain raw sensitive values: %q", result.RedactedPrompt)
	}
}

func TestP0EngineUsesEntityConsistentPlaceholdersForRepeatedPII(t *testing.T) {
	engine := NewP0Engine()

	result, err := engine.Apply(context.Background(), ApplyRequest{
		Prompt: "Contact user@example.invalid, then user@example.invalid again. Call 010-0000-0000 or 010 0000 0000.",
	})
	if err != nil {
		t.Fatalf("Apply returned error: %v", err)
	}

	if result.Action != ActionRedacted {
		t.Fatalf("expected redacted action, got %s", result.Action)
	}
	if strings.Count(result.RedactedPrompt, "[EMAIL_1]") != 2 {
		t.Fatalf("expected repeated email to reuse [EMAIL_1], got %q", result.RedactedPrompt)
	}
	if strings.Count(result.RedactedPrompt, "[PHONE_NUMBER_1]") != 2 {
		t.Fatalf("expected normalized repeated phone to reuse [PHONE_NUMBER_1], got %q", result.RedactedPrompt)
	}
	if strings.Contains(result.RedactedPrompt, "user@example.invalid") ||
		strings.Contains(result.RedactedPrompt, "010-0000-0000") ||
		strings.Contains(result.RedactedPrompt, "010 0000 0000") {
		t.Fatalf("redacted prompt must not contain raw sensitive values: %q", result.RedactedPrompt)
	}
}

func TestP0EngineRedactsConservativeLabeledNameOrganizationAndAddress(t *testing.T) {
	engine := NewP0Engine()

	result, err := engine.Apply(context.Background(), ApplyRequest{
		Prompt: "customer_name=Alex Kim, organization=Acme Corp, address=100 Example Street",
	})
	if err != nil {
		t.Fatalf("Apply returned error: %v", err)
	}

	if result.Action != ActionRedacted {
		t.Fatalf("expected redacted action, got %s", result.Action)
	}
	for _, placeholder := range []string{"[PERSON_1]", "[ORGANIZATION_1]", "[ADDRESS_1]"} {
		if !strings.Contains(result.RedactedPrompt, placeholder) {
			t.Fatalf("expected redacted prompt to contain %s, got %q", placeholder, result.RedactedPrompt)
		}
	}
	for _, rawValue := range []string{"Alex Kim", "Acme Corp", "100 Example Street"} {
		if strings.Contains(result.RedactedPrompt, rawValue) {
			t.Fatalf("redacted prompt must not include raw value %q: %q", rawValue, result.RedactedPrompt)
		}
	}
	if !reflect.DeepEqual(result.DetectedTypes, []string{"organization_name", "person_name", "postal_address"}) {
		t.Fatalf("expected stable sorted detected types, got %#v", result.DetectedTypes)
	}
}

func TestP0EngineUsesRoleAwarePlaceholdersForExplicitPersonRoles(t *testing.T) {
	engine := NewP0Engine()

	result, err := engine.Apply(context.Background(), ApplyRequest{
		Prompt: "customer_name=Alex Kim, agent_name=Jamie Park, doctor_name=Pat Lee, patient_name=Riley Cho, name=Taylor Lee",
	})
	if err != nil {
		t.Fatalf("Apply returned error: %v", err)
	}

	if result.Action != ActionRedacted {
		t.Fatalf("expected redacted action, got %s", result.Action)
	}
	for _, placeholder := range []string{"[CUSTOMER_1]", "[AGENT_1]", "[DOCTOR_1]", "[PATIENT_1]", "[PERSON_1]"} {
		if !strings.Contains(result.RedactedPrompt, placeholder) {
			t.Fatalf("expected redacted prompt to contain %s, got %q", placeholder, result.RedactedPrompt)
		}
	}
	for _, rawValue := range []string{"Alex Kim", "Jamie Park", "Pat Lee", "Riley Cho", "Taylor Lee"} {
		if strings.Contains(result.RedactedPrompt, rawValue) {
			t.Fatalf("redacted prompt must not include raw value %q: %q", rawValue, result.RedactedPrompt)
		}
	}
}

func TestP0EngineKeepsFirstRoleForRepeatedPersonName(t *testing.T) {
	engine := NewP0Engine()

	result, err := engine.Apply(context.Background(), ApplyRequest{
		Prompt: "customer_name=Alex Kim, patient_name=Alex Kim",
	})
	if err != nil {
		t.Fatalf("Apply returned error: %v", err)
	}

	if strings.Count(result.RedactedPrompt, "[CUSTOMER_1]") != 2 {
		t.Fatalf("expected repeated person to keep first role placeholder, got %q", result.RedactedPrompt)
	}
	if strings.Contains(result.RedactedPrompt, "[PATIENT_1]") {
		t.Fatalf("expected first role to win over later conflicting role, got %q", result.RedactedPrompt)
	}
	if strings.Contains(result.RedactedPrompt, "Alex Kim") {
		t.Fatalf("redacted prompt must not include raw person name: %q", result.RedactedPrompt)
	}
}

func TestP0EngineUsesRoleAwarePlaceholdersForKoreanPersonRoles(t *testing.T) {
	engine := NewP0Engine()

	result, err := engine.Apply(context.Background(), ApplyRequest{
		Prompt: "\uace0\uac1d \uc774\uc724\uc9c0\uac00 \uc0c1\ub2f4\uc6d0 \uae40\ubbfc\uc218\uc5d0\uac8c \ud658\ubd88\uc744 \uc694\uccad\ud588\ub2e4. \ub2f4\ub2f9 \uc758\uc0ac \ubc15\uc9c0\ud6c8\uc774 \ud658\uc790 \ucd5c\uc11c\uc5f0\uc5d0\uac8c \uc124\uba85\ud588\ub2e4.",
	})
	if err != nil {
		t.Fatalf("Apply returned error: %v", err)
	}

	expected := "[CUSTOMER_1]\uac00 [AGENT_1]\uc5d0\uac8c \ud658\ubd88\uc744 \uc694\uccad\ud588\ub2e4. [DOCTOR_1]\uc774 [PATIENT_1]\uc5d0\uac8c \uc124\uba85\ud588\ub2e4."
	if result.RedactedPrompt != expected {
		t.Fatalf("expected role labels to be folded into placeholders %q, got %q", expected, result.RedactedPrompt)
	}
	for _, placeholder := range []string{"[CUSTOMER_1]", "[AGENT_1]", "[DOCTOR_1]", "[PATIENT_1]"} {
		if !strings.Contains(result.RedactedPrompt, placeholder) {
			t.Fatalf("expected redacted prompt to contain %s, got %q", placeholder, result.RedactedPrompt)
		}
	}
	for _, rawValue := range []string{"\uc774\uc724\uc9c0", "\uae40\ubbfc\uc218", "\ubc15\uc9c0\ud6c8", "\ucd5c\uc11c\uc5f0"} {
		if strings.Contains(result.RedactedPrompt, rawValue) {
			t.Fatalf("redacted prompt must not include raw value %q: %q", rawValue, result.RedactedPrompt)
		}
	}
}

func TestP0EngineUsesSemanticPlaceholdersForRecruitingPersonRoles(t *testing.T) {
	engine := NewP0Engine()

	result, err := engine.Apply(context.Background(), ApplyRequest{
		Prompt: "applicant Alex Kim sent resume to interviewer Jamie Park. \uc9c0\uc6d0\uc790 \uc774\uc724\uc9c0\uac00 \uba74\uc811\uad00 \uae40\ubbfc\uc218\uc5d0\uac8c \uc774\ub825\uc11c\ub97c \ubcf4\ub0c8\ub2e4.",
	})
	if err != nil {
		t.Fatalf("Apply returned error: %v", err)
	}

	expected := "[APPLICANT_1] sent resume to [INTERVIEWER_1]. [APPLICANT_2]\uac00 [INTERVIEWER_2]\uc5d0\uac8c \uc774\ub825\uc11c\ub97c \ubcf4\ub0c8\ub2e4."
	if result.RedactedPrompt != expected {
		t.Fatalf("expected semantic role placeholders %q, got %q", expected, result.RedactedPrompt)
	}
	for _, rawValue := range []string{"Alex Kim", "Jamie Park", "\uc774\uc724\uc9c0", "\uae40\ubbfc\uc218"} {
		if strings.Contains(result.RedactedPrompt, rawValue) {
			t.Fatalf("redacted prompt must not include raw value %q: %q", rawValue, result.RedactedPrompt)
		}
	}
}

func TestP0EnginePreservesBusinessRoleRelationship(t *testing.T) {
	engine := NewP0Engine()

	result, err := engine.Apply(context.Background(), ApplyRequest{
		Prompt: "\uae40\ubbfc\uc218\uc758 \ud300\uc7a5 \uc774\uc724\uc9c0\uac00 \uc2b9\uc778\ud588\ub2e4.",
	})
	if err != nil {
		t.Fatalf("Apply returned error: %v", err)
	}

	expected := "[PERSON_1]\uc758 [ROLE:\ud300\uc7a5] [PERSON_2]\uac00 \uc2b9\uc778\ud588\ub2e4."
	if result.RedactedPrompt != expected {
		t.Fatalf("expected role-preserving prompt %q, got %q", expected, result.RedactedPrompt)
	}
	for _, rawValue := range []string{"\uae40\ubbfc\uc218", "\uc774\uc724\uc9c0"} {
		if strings.Contains(result.RedactedPrompt, rawValue) {
			t.Fatalf("redacted prompt must not include raw person name %q: %q", rawValue, result.RedactedPrompt)
		}
	}
}

func TestEngineLinksKoreanPersonAliasesToUniqueFullNameAnchor(t *testing.T) {
	fullName := "\uc774\uc724\uc9c0"
	givenName := "\uc724\uc9c0"
	familyName := "\uc774"
	prompt := fullName + "\ub294 \ud68c\uc758\uc5d0 \ucc38\uc11d\ud588\ub2e4. " +
		givenName + "\ub2d8\uc740 \ubc1c\ud45c\ub97c \ub9e1\uc558\ub2e4. " +
		familyName + " \ud300\uc7a5\uc740 \uc2b9\uc778\ud588\ub2e4."
	engine := NewEngine(
		NewRegistry(staticDetector{detections: []Detection{
			personDetection(prompt, fullName, 1),
			personDetection(prompt, givenName, 2),
			personDetectionAt(prompt, familyName+" \ud300\uc7a5", familyName),
		}}),
		DefaultSecurityPolicyVersionID,
	)

	result, err := engine.Apply(context.Background(), ApplyRequest{Prompt: prompt})
	if err != nil {
		t.Fatalf("Apply returned error: %v", err)
	}

	expected := "[PERSON_1]\ub294 \ud68c\uc758\uc5d0 \ucc38\uc11d\ud588\ub2e4. " +
		"[PERSON_1]\ub2d8\uc740 \ubc1c\ud45c\ub97c \ub9e1\uc558\ub2e4. " +
		"[PERSON_1] [ROLE:\ud300\uc7a5]\uc740 \uc2b9\uc778\ud588\ub2e4."
	if result.RedactedPrompt != expected {
		t.Fatalf("expected alias-linked prompt %q, got %q", expected, result.RedactedPrompt)
	}
	if strings.Count(result.RedactedPrompt, "[PERSON_1]") != 3 {
		t.Fatalf("expected aliases to reuse [PERSON_1], got %q", result.RedactedPrompt)
	}
	for _, rawValue := range []string{fullName, givenName} {
		if strings.Contains(result.RedactedPrompt, rawValue) {
			t.Fatalf("redacted prompt must not include raw person alias %q: %q", rawValue, result.RedactedPrompt)
		}
	}
}

func TestEntityScopeNormalizesKoreanPersonNamesWithContiguousBusinessRoleSuffix(t *testing.T) {
	scope := NewEntityScope()

	spaced := scope.PlaceholderFor(string(DetectorPersonName), "\ud64d\uae38\ub3d9 \ud300\uc7a5", PlaceholderPersonName)
	contiguous := scope.PlaceholderFor(string(DetectorPersonName), "\ud64d\uae38\ub3d9\ud300\uc7a5", PlaceholderPersonName)
	plain := scope.PlaceholderFor(string(DetectorPersonName), "\ud64d\uae38\ub3d9", PlaceholderPersonName)
	unrelated := scope.PlaceholderFor(string(DetectorPersonName), "AlexManager", PlaceholderPersonName)

	if spaced != "[PERSON_1]" {
		t.Fatalf("expected first placeholder [PERSON_1], got %q", spaced)
	}
	if contiguous != spaced {
		t.Fatalf("expected contiguous business role suffix to reuse %q, got %q", spaced, contiguous)
	}
	if plain != spaced {
		t.Fatalf("expected plain name to reuse %q, got %q", spaced, plain)
	}
	if unrelated == spaced {
		t.Fatalf("expected non-Korean contiguous role-like suffix to keep a separate placeholder, got %q", unrelated)
	}
}

func TestEngineDoesNotLinkAmbiguousKoreanPersonAlias(t *testing.T) {
	firstName := "\uc774\uc724\uc9c0"
	secondName := "\ubc15\uc724\uc9c0"
	alias := "\uc724\uc9c0"
	prompt := firstName + "\uc640 " + secondName + "\uac00 \ucc38\uc11d\ud588\ub2e4. " +
		alias + "\ub2d8\uc774 \ubc1c\ud45c\ud588\ub2e4."
	engine := NewEngine(
		NewRegistry(staticDetector{detections: []Detection{
			personDetection(prompt, firstName, 1),
			personDetection(prompt, secondName, 1),
			personDetectionAt(prompt, alias+"\ub2d8", alias),
		}}),
		DefaultSecurityPolicyVersionID,
	)

	result, err := engine.Apply(context.Background(), ApplyRequest{Prompt: prompt})
	if err != nil {
		t.Fatalf("Apply returned error: %v", err)
	}

	expected := "[PERSON_1]\uc640 [PERSON_2]\uac00 \ucc38\uc11d\ud588\ub2e4. [PERSON_3]\ub2d8\uc774 \ubc1c\ud45c\ud588\ub2e4."
	if result.RedactedPrompt != expected {
		t.Fatalf("expected ambiguous alias to stay separate %q, got %q", expected, result.RedactedPrompt)
	}
	if strings.Contains(result.RedactedPrompt, firstName) ||
		strings.Contains(result.RedactedPrompt, secondName) ||
		strings.Contains(result.RedactedPrompt, alias+"\ub2d8") {
		t.Fatalf("redacted prompt must not include raw person aliases: %q", result.RedactedPrompt)
	}
}

func TestEnginePreservesCoreferenceForPreviousUniqueSubject(t *testing.T) {
	senderName := "\uc774\uc724\uc9c0"
	recipientName := "\uae40\ubbfc\uc218"
	prompt := senderName + "\uac00 " + recipientName + "\uc5d0\uac8c \uba54\uc77c\uc744 \ubcf4\ub0c8\ub2e4. " +
		"\uadf8\ub140\ub294 \ub2f5\uc7a5\uc744 \uae30\ub2e4\ub838\ub2e4."
	engine := NewEngine(
		NewRegistry(staticDetector{detections: []Detection{
			personDetection(prompt, senderName, 1),
			personDetection(prompt, recipientName, 1),
		}}),
		DefaultSecurityPolicyVersionID,
	)

	result, err := engine.Apply(context.Background(), ApplyRequest{Prompt: prompt})
	if err != nil {
		t.Fatalf("Apply returned error: %v", err)
	}

	expected := "[PERSON_1]\uac00 [PERSON_2]\uc5d0\uac8c \uba54\uc77c\uc744 \ubcf4\ub0c8\ub2e4. " +
		"[PERSON_1]\ub294 \ub2f5\uc7a5\uc744 \uae30\ub2e4\ub838\ub2e4."
	if result.RedactedPrompt != expected {
		t.Fatalf("expected coreference-preserving prompt %q, got %q", expected, result.RedactedPrompt)
	}
	if strings.Contains(result.RedactedPrompt, senderName) ||
		strings.Contains(result.RedactedPrompt, recipientName) ||
		strings.Contains(result.RedactedPrompt, "\uadf8\ub140") {
		t.Fatalf("redacted prompt must not include raw person/coreference text: %q", result.RedactedPrompt)
	}
}

func TestEngineLeavesCoreferenceWhenPreviousSubjectIsAmbiguous(t *testing.T) {
	firstName := "\uc774\uc724\uc9c0"
	secondName := "\uae40\ubbfc\uc218"
	prompt := firstName + "\uc640 " + secondName + "\uac00 \ucc38\uc11d\ud588\ub2e4. " +
		"\uadf8\ub140\ub294 \ubc1c\ud45c\ub97c \uc900\ube44\ud588\ub2e4."
	engine := NewEngine(
		NewRegistry(staticDetector{detections: []Detection{
			personDetection(prompt, firstName, 1),
			personDetection(prompt, secondName, 1),
		}}),
		DefaultSecurityPolicyVersionID,
	)

	result, err := engine.Apply(context.Background(), ApplyRequest{Prompt: prompt})
	if err != nil {
		t.Fatalf("Apply returned error: %v", err)
	}

	expected := "[PERSON_1]\uc640 [PERSON_2]\uac00 \ucc38\uc11d\ud588\ub2e4. " +
		"\uadf8\ub140\ub294 \ubc1c\ud45c\ub97c \uc900\ube44\ud588\ub2e4."
	if result.RedactedPrompt != expected {
		t.Fatalf("expected ambiguous coreference to stay unchanged %q, got %q", expected, result.RedactedPrompt)
	}
}

func TestEnginePreservesEnglishCoreferenceForPreviousUniqueSubject(t *testing.T) {
	senderName := "Alex Kim"
	recipientName := "Jamie Park"
	prompt := senderName + " emailed " + recipientName + ". She waited for a reply."
	engine := NewEngine(
		NewRegistry(staticDetector{detections: []Detection{
			personDetection(prompt, senderName, 1),
			personDetection(prompt, recipientName, 1),
		}}),
		DefaultSecurityPolicyVersionID,
	)

	result, err := engine.Apply(context.Background(), ApplyRequest{Prompt: prompt})
	if err != nil {
		t.Fatalf("Apply returned error: %v", err)
	}

	expected := "[PERSON_1] emailed [PERSON_2]. [PERSON_1] waited for a reply."
	if result.RedactedPrompt != expected {
		t.Fatalf("expected English coreference-preserving prompt %q, got %q", expected, result.RedactedPrompt)
	}
}

func TestEnginePreservesStructureAroundOverextendedPIISpans(t *testing.T) {
	nameWithHonorific := "\uc774\uc724\uc9c0\ub2d8"
	emailWithCopula := "yoonji@example.com\uc785\ub2c8\ub2e4"
	prompt := nameWithHonorific + "\uc758 \uc774\uba54\uc77c \uc8fc\uc18c\ub294 " + emailWithCopula + "."
	engine := NewEngine(
		NewRegistry(staticDetector{detections: []Detection{
			personDetection(prompt, nameWithHonorific, 1),
			{
				Type:        string(DetectorEmail),
				Start:       strings.Index(prompt, emailWithCopula),
				End:         strings.Index(prompt, emailWithCopula) + len(emailWithCopula),
				Action:      ActionRedacted,
				Placeholder: PlaceholderEmail,
				Priority:    10,
			},
		}}),
		DefaultSecurityPolicyVersionID,
	)

	result, err := engine.Apply(context.Background(), ApplyRequest{Prompt: prompt})
	if err != nil {
		t.Fatalf("Apply returned error: %v", err)
	}

	expected := "[PERSON_1]\ub2d8\uc758 \uc774\uba54\uc77c \uc8fc\uc18c\ub294 [EMAIL_1]\uc785\ub2c8\ub2e4."
	if result.RedactedPrompt != expected {
		t.Fatalf("expected structure-preserving prompt %q, got %q", expected, result.RedactedPrompt)
	}
	if strings.Contains(result.RedactedPrompt, "\uc774\uc724\uc9c0") || strings.Contains(result.RedactedPrompt, "yoonji@example.com") {
		t.Fatalf("redacted prompt must not contain raw PII: %q", result.RedactedPrompt)
	}
}

func TestEnginePreservesKoreanParticlesAroundPersonNames(t *testing.T) {
	personName := "\uc774\uc724\uc9c0"
	rawSpans := []string{
		personName + "\ub294",
		personName + "\uac00",
		personName + "\ub97c",
		personName + "\uc5d0\uac8c",
		personName + "\uc640",
		personName + "\uc758",
	}
	prompt := strings.Join(rawSpans, " ") + " \uae30\ub85d\uc744 \ud655\uc778\ud588\ub2e4."
	detections := make([]Detection, 0, len(rawSpans))
	for _, rawSpan := range rawSpans {
		detections = append(detections, personDetection(prompt, rawSpan, 1))
	}
	engine := NewEngine(
		NewRegistry(staticDetector{detections: detections}),
		DefaultSecurityPolicyVersionID,
	)

	result, err := engine.Apply(context.Background(), ApplyRequest{Prompt: prompt})
	if err != nil {
		t.Fatalf("Apply returned error: %v", err)
	}

	expected := "[PERSON_1]\ub294 [PERSON_1]\uac00 [PERSON_1]\ub97c [PERSON_1]\uc5d0\uac8c [PERSON_1]\uc640 [PERSON_1]\uc758 \uae30\ub85d\uc744 \ud655\uc778\ud588\ub2e4."
	if result.RedactedPrompt != expected {
		t.Fatalf("expected particle-preserving prompt %q, got %q", expected, result.RedactedPrompt)
	}
	if strings.Contains(result.RedactedPrompt, personName) {
		t.Fatalf("redacted prompt must not contain raw person name: %q", result.RedactedPrompt)
	}
}

func TestEnginePreservesHonorificAndRoleMarkersAroundPersonNames(t *testing.T) {
	rawSpans := []string{
		"\uc774\uc724\uc9c0\ub2d8",
		"\uae40\ubbfc\uc218 \ud300\uc7a5\ub2d8\uaed8",
		"\ubc15\uc9c0\ud6c8 \uc120\uc0dd\ub2d8\uc774",
		"\ucd5c\uc11c\uc5f0 \ub300\ud45c\ub2d8\uc5d0\uac8c",
	}
	prompt := rawSpans[0] + "\uc774 " + rawSpans[1] + " \uc5f0\ub77d\ud588\ub2e4. " +
		rawSpans[2] + " " + rawSpans[3] + " \uc548\ub0b4\ud588\ub2e4."
	detections := make([]Detection, 0, len(rawSpans))
	for _, rawSpan := range rawSpans {
		detections = append(detections, personDetection(prompt, rawSpan, 1))
	}
	engine := NewEngine(
		NewRegistry(staticDetector{detections: detections}),
		DefaultSecurityPolicyVersionID,
	)

	result, err := engine.Apply(context.Background(), ApplyRequest{Prompt: prompt})
	if err != nil {
		t.Fatalf("Apply returned error: %v", err)
	}

	expected := "[PERSON_1]\ub2d8\uc774 [PERSON_2] \ud300\uc7a5\ub2d8\uaed8 \uc5f0\ub77d\ud588\ub2e4. " +
		"[PERSON_3] \uc120\uc0dd\ub2d8\uc774 [PERSON_4] \ub300\ud45c\ub2d8\uc5d0\uac8c \uc548\ub0b4\ud588\ub2e4."
	if result.RedactedPrompt != expected {
		t.Fatalf("expected honorific-preserving prompt %q, got %q", expected, result.RedactedPrompt)
	}
	for _, rawName := range []string{"\uc774\uc724\uc9c0", "\uae40\ubbfc\uc218", "\ubc15\uc9c0\ud6c8", "\ucd5c\uc11c\uc5f0"} {
		if strings.Contains(result.RedactedPrompt, rawName) {
			t.Fatalf("redacted prompt must not contain raw person name %q: %q", rawName, result.RedactedPrompt)
		}
	}
}

func TestEnginePreservesBoundariesAfterOverextendedKoreanPersonNames(t *testing.T) {
	rawSpans := []string{
		"\uc774\uc724\uc9c0\ub2d8\uaed8\uc11c\ub294",
		"\uae40\ubbfc\uc218\ud300\uc7a5\ub2d8",
	}
	prompt := rawSpans[0] + " \uc624\ub298 \ucc38\uc11d\ud569\ub2c8\ub2e4. " + rawSpans[1] + "\ub3c4 \ucc38\uc11d\ud569\ub2c8\ub2e4."
	detections := make([]Detection, 0, len(rawSpans))
	for _, rawSpan := range rawSpans {
		detections = append(detections, personDetection(prompt, rawSpan, 1))
	}
	engine := NewEngine(
		NewRegistry(staticDetector{detections: detections}),
		DefaultSecurityPolicyVersionID,
	)

	result, err := engine.Apply(context.Background(), ApplyRequest{Prompt: prompt})
	if err != nil {
		t.Fatalf("Apply returned error: %v", err)
	}

	expected := "[PERSON_1]\ub2d8\uaed8\uc11c\ub294 \uc624\ub298 \ucc38\uc11d\ud569\ub2c8\ub2e4. " +
		"[PERSON_2]\ud300\uc7a5\ub2d8\ub3c4 \ucc38\uc11d\ud569\ub2c8\ub2e4."
	if result.RedactedPrompt != expected {
		t.Fatalf("expected boundary-preserving prompt %q, got %q", expected, result.RedactedPrompt)
	}
	for _, rawName := range []string{"\uc774\uc724\uc9c0", "\uae40\ubbfc\uc218"} {
		if strings.Contains(result.RedactedPrompt, rawName) {
			t.Fatalf("redacted prompt must not contain raw person name %q: %q", rawName, result.RedactedPrompt)
		}
	}
}

func TestP0EngineBlocksCriticalDetectors(t *testing.T) {
	tests := []struct {
		name         string
		prompt       string
		detectorType string
	}{
		{
			name:         "api key",
			prompt:       "api_key=test_secret_token_redacted_for_demo_only_1234567890",
			detectorType: string(DetectorAPIKey),
		},
		{
			name:         "jwt",
			prompt:       "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ0ZXN0In0.signature_for_test_only",
			detectorType: string(DetectorJWT),
		},
		{
			name:         "rrn",
			prompt:       "000101-3000000",
			detectorType: string(DetectorResidentRegistrationNumber),
		},
		{
			name:         "authorization header",
			prompt:       "Authorization: Bearer test_secret_token_redacted_for_demo_only_1234567890",
			detectorType: string(DetectorAuthorizationHeader),
		},
		{
			name:         "private key",
			prompt:       "-----BEGIN PRIVATE KEY-----\ntestsecretredactedfordemoonly\n-----END PRIVATE KEY-----",
			detectorType: string(DetectorPrivateKey),
		},
	}

	engine := NewP0Engine()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := engine.Apply(context.Background(), ApplyRequest{Prompt: tt.prompt})
			if err != nil {
				t.Fatalf("Apply returned error: %v", err)
			}
			if result.Action != ActionBlocked {
				t.Fatalf("expected blocked action, got %s", result.Action)
			}
			if !reflect.DeepEqual(result.DetectedTypes, []string{tt.detectorType}) {
				t.Fatalf("unexpected detected types: %#v", result.DetectedTypes)
			}
			if result.DetectedCount != 1 {
				t.Fatalf("expected detected count 1, got %d", result.DetectedCount)
			}
			if strings.Contains(result.RedactedPrompt, tt.prompt) {
				t.Fatalf("redacted prompt must not include raw blocked value: %q", result.RedactedPrompt)
			}
		})
	}
}

func TestP0EngineLeavesSafePromptUnchanged(t *testing.T) {
	engine := NewP0Engine()
	prompt := "Write a short safe refund response."

	result, err := engine.Apply(context.Background(), ApplyRequest{Prompt: prompt})
	if err != nil {
		t.Fatalf("Apply returned error: %v", err)
	}
	if result.Action != ActionNone {
		t.Fatalf("expected none action, got %s", result.Action)
	}
	if result.DetectedCount != 0 || len(result.DetectedTypes) != 0 {
		t.Fatalf("expected no detections, got count=%d types=%#v", result.DetectedCount, result.DetectedTypes)
	}
	if result.RedactedPrompt != prompt {
		t.Fatalf("expected safe prompt unchanged, got %q", result.RedactedPrompt)
	}
}

func TestP0EngineAppliesDetectorPolicyAllowWithLogSafePrompt(t *testing.T) {
	engine := NewP0Engine()
	prompt := "Contact user@example.invalid or 010-0000-0000."

	result, err := engine.Apply(context.Background(), ApplyRequest{
		Prompt: prompt,
		DetectorPolicies: []DetectorPolicy{
			{DetectorType: string(DetectorPhoneNumber), Action: PolicyActionAllow},
		},
	})
	if err != nil {
		t.Fatalf("Apply returned error: %v", err)
	}
	if result.Action != ActionRedacted {
		t.Fatalf("expected redacted action from email, got %s", result.Action)
	}
	if !reflect.DeepEqual(result.DetectedTypes, []string{"email"}) {
		t.Fatalf("expected only email as protected detection, got %#v", result.DetectedTypes)
	}
	if !reflect.DeepEqual(result.PolicyAllowedTypes, []string{"phone_number"}) {
		t.Fatalf("expected phone as policy allowed type, got %#v", result.PolicyAllowedTypes)
	}
	if !strings.Contains(result.RedactedPrompt, "010-0000-0000") {
		t.Fatalf("provider prompt should keep allowed phone value, got %q", result.RedactedPrompt)
	}
	if strings.Contains(result.LogSafePrompt, "010-0000-0000") || strings.Contains(result.RedactedPromptPreview, "010-0000-0000") {
		t.Fatalf("log-safe prompt and preview must not include allowed raw phone: prompt=%q preview=%q", result.LogSafePrompt, result.RedactedPromptPreview)
	}
	if !strings.Contains(result.LogSafePrompt, PlaceholderPhoneNumber) {
		t.Fatalf("expected log-safe prompt to mask allowed phone, got %q", result.LogSafePrompt)
	}
}

func TestP0EngineKeepsMandatoryDetectorProtectedWhenAllowRequested(t *testing.T) {
	engine := NewP0Engine()
	rawSecret := "test_secret_token_redacted_for_demo_only_1234567890"

	result, err := engine.Apply(context.Background(), ApplyRequest{
		Prompt: "api_key=" + rawSecret,
		DetectorPolicies: []DetectorPolicy{
			{DetectorType: string(DetectorAPIKey), Action: PolicyActionAllow},
		},
	})
	if err != nil {
		t.Fatalf("Apply returned error: %v", err)
	}
	if result.Action != ActionBlocked {
		t.Fatalf("mandatory api key must remain blocked, got %s", result.Action)
	}
	if !reflect.DeepEqual(result.MandatoryProtectedTypes, []string{"api_key"}) {
		t.Fatalf("expected mandatory protected api_key, got %#v", result.MandatoryProtectedTypes)
	}
	if strings.Contains(result.RedactedPrompt, rawSecret) || strings.Contains(result.LogSafePrompt, rawSecret) {
		t.Fatalf("mandatory raw secret must not remain in protected prompts")
	}
}

func TestEngineTrimsDetectionTypeBeforePolicyAndMandatoryAudit(t *testing.T) {
	rawSecret := "test_secret_token_redacted_for_demo_only_1234567890"
	engine := NewEngine(NewRegistry(staticDetector{
		detections: []Detection{{
			Type:     " api_key ",
			Start:    8,
			End:      8 + len(rawSecret),
			Action:   ActionBlocked,
			Priority: 1,
		}},
	}), DefaultSecurityPolicyVersionID)

	result, err := engine.Apply(context.Background(), ApplyRequest{
		Prompt: "api_key=" + rawSecret,
		DetectorPolicies: []DetectorPolicy{
			{DetectorType: string(DetectorAPIKey), Action: PolicyActionAllow},
		},
	})
	if err != nil {
		t.Fatalf("Apply returned error: %v", err)
	}
	if result.Action != ActionBlocked {
		t.Fatalf("trimmed mandatory detector must remain blocked, got %s", result.Action)
	}
	if !reflect.DeepEqual(result.DetectedTypes, []string{"api_key"}) {
		t.Fatalf("expected trimmed detected type, got %#v", result.DetectedTypes)
	}
	if !reflect.DeepEqual(result.MandatoryProtectedTypes, []string{"api_key"}) {
		t.Fatalf("expected trimmed mandatory protected type, got %#v", result.MandatoryProtectedTypes)
	}
	if strings.Contains(result.RedactedPrompt, rawSecret) || !strings.Contains(result.RedactedPrompt, PlaceholderAPIKey) {
		t.Fatalf("expected trimmed detector type to use api key placeholder, got %q", result.RedactedPrompt)
	}
}

func TestP0EngineBoundsRedactedPromptPreview(t *testing.T) {
	engine := NewP0Engine()
	prompt := strings.Repeat("safe ", 40)

	result, err := engine.Apply(context.Background(), ApplyRequest{Prompt: prompt})
	if err != nil {
		t.Fatalf("Apply returned error: %v", err)
	}
	if result.RedactedPrompt != prompt {
		t.Fatalf("expected full redacted prompt to remain available in memory, got %q", result.RedactedPrompt)
	}
	if len([]rune(result.RedactedPromptPreview)) > RedactedPromptPreviewMaxRunes+3 {
		t.Fatalf("expected preview to be bounded, got length=%d preview=%q", len([]rune(result.RedactedPromptPreview)), result.RedactedPromptPreview)
	}
	if strings.Contains(result.RedactedPromptPreview, "  ") || strings.Contains(result.RedactedPromptPreview, "\n") {
		t.Fatalf("expected normalized preview, got %q", result.RedactedPromptPreview)
	}
	if !strings.HasSuffix(result.RedactedPromptPreview, "...") {
		t.Fatalf("expected truncated preview suffix, got %q", result.RedactedPromptPreview)
	}
}

func TestP0EngineBlockWinsOverRedact(t *testing.T) {
	engine := NewP0Engine()

	result, err := engine.Apply(context.Background(), ApplyRequest{
		Prompt: "Contact user@example.invalid with api_key=test_secret_token_redacted_for_demo_only_1234567890",
	})
	if err != nil {
		t.Fatalf("Apply returned error: %v", err)
	}

	if result.Action != ActionBlocked {
		t.Fatalf("expected block to win over redact, got %s", result.Action)
	}
	if !reflect.DeepEqual(result.DetectedTypes, []string{"api_key", "email"}) {
		t.Fatalf("expected stable sorted detected types, got %#v", result.DetectedTypes)
	}
	if result.DetectedCount != 2 {
		t.Fatalf("expected detected count 2, got %d", result.DetectedCount)
	}
}

func TestEffectiveDetectionsPrefersBlockingOverlap(t *testing.T) {
	selected := effectiveDetections([]Detection{
		{
			Type:        string(DetectorEmail),
			Start:       0,
			End:         20,
			Action:      ActionRedacted,
			Placeholder: PlaceholderEmail,
			Priority:    50,
		},
		{
			Type:        string(DetectorAPIKey),
			Start:       0,
			End:         12,
			Action:      ActionBlocked,
			Placeholder: PlaceholderAPIKey,
			Priority:    10,
		},
	})

	if len(selected) != 1 {
		t.Fatalf("expected one effective detection, got %#v", selected)
	}
	if selected[0].Type != string(DetectorAPIKey) {
		t.Fatalf("expected blocking api_key overlap to win, got %#v", selected[0])
	}
}

func TestEngineMergesAdjacentAddressFragments(t *testing.T) {
	fragments := []string{
		"\uc11c\uc6b8\ud2b9\ubcc4\uc2dc",
		"\ub9c8\ud3ec\uad6c",
		"\ub3d9\uad50\ub3d9 123-45",
	}
	prompt := "\ubc30\uc1a1\uc9c0\ub294 " + strings.Join(fragments, " ") + " \uc785\ub2c8\ub2e4."
	detections := make([]Detection, 0, len(fragments))
	for _, fragment := range fragments {
		start := strings.Index(prompt, fragment)
		if start < 0 {
			t.Fatalf("test fragment not found: %q", fragment)
		}
		detections = append(detections, Detection{
			Type:        string(DetectorPostalAddress),
			Start:       start,
			End:         start + len(fragment),
			Action:      ActionRedacted,
			Placeholder: PlaceholderPostalAddress,
			Priority:    35,
		})
	}
	engine := NewEngine(
		NewRegistry(staticDetector{detections: detections}),
		DefaultSecurityPolicyVersionID,
	)

	result, err := engine.Apply(context.Background(), ApplyRequest{Prompt: prompt})
	if err != nil {
		t.Fatalf("Apply returned error: %v", err)
	}

	expected := "\ubc30\uc1a1\uc9c0\ub294 [ADDRESS_1] \uc785\ub2c8\ub2e4."
	if result.RedactedPrompt != expected {
		t.Fatalf("expected merged address placeholder %q, got %q", expected, result.RedactedPrompt)
	}
	if result.DetectedCount != 1 {
		t.Fatalf("expected one merged address detection, got %d", result.DetectedCount)
	}
	for _, fragment := range fragments {
		if strings.Contains(result.RedactedPrompt, fragment) {
			t.Fatalf("redacted prompt must not include address fragment %q: %q", fragment, result.RedactedPrompt)
		}
	}
}

type staticDetector struct {
	detections []Detection
}

func (d staticDetector) Type() string {
	return "static_test_detector"
}

func (d staticDetector) Priority() int {
	return 1
}

func (d staticDetector) Detect(input string) []Detection {
	detections := make([]Detection, len(d.detections))
	copy(detections, d.detections)
	return detections
}

func personDetection(input string, rawValue string, occurrence int) Detection {
	start := nthStringIndex(input, rawValue, occurrence)
	return Detection{
		Type:        string(DetectorPersonName),
		Start:       start,
		End:         start + len(rawValue),
		Action:      ActionRedacted,
		Placeholder: PlaceholderPersonName,
		Priority:    10,
	}
}

func personDetectionAt(input string, marker string, rawValue string) Detection {
	markerStart := strings.Index(input, marker)
	if markerStart < 0 {
		panic("test marker not found")
	}
	relativeStart := strings.Index(input[markerStart:], rawValue)
	if relativeStart < 0 {
		panic("test raw value not found after marker")
	}
	start := markerStart + relativeStart
	return Detection{
		Type:        string(DetectorPersonName),
		Start:       start,
		End:         start + len(rawValue),
		Action:      ActionRedacted,
		Placeholder: PlaceholderPersonName,
		Priority:    10,
	}
}

func nthStringIndex(input string, value string, occurrence int) int {
	start := -1
	for i := 0; i < occurrence; i++ {
		next := strings.Index(input[start+1:], value)
		if next < 0 {
			panic("test value occurrence not found")
		}
		start += next + 1
	}
	return start
}
