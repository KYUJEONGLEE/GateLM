package routing

import (
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

const maxCategoryScanBytes = 4096

type payloadBoundaryEvidence uint8

const (
	payloadBoundaryCodeFence payloadBoundaryEvidence = 1 << iota
	payloadBoundaryTag
	payloadBoundaryHeading
	payloadBoundaryBeginEnd
	payloadBoundaryBlockQuote
	payloadBoundaryCue
)

type payloadSplitConfidence uint8

const (
	payloadSplitConfidenceNone payloadSplitConfidence = iota
	payloadSplitConfidenceLow
	payloadSplitConfidenceMedium
	payloadSplitConfidenceHigh
)

// PromptFeatures is the shared, request-local input to routing classifiers.
// Its fields stay private so normalized prompt material and tokens cannot be
// serialized into routing responses, diagnostics, logs, events, or metrics.
type PromptFeatures struct {
	normalizedText    string
	instructionText   string
	payloadText       string
	tokens            map[string]struct{}
	instructionTokens map[string]struct{}

	promptRuneLength  int
	wordCount         int
	clauseCount       int
	taskCount         int
	constraintCount   int
	scopeCount        int
	dependencyDepth   int
	languageBucket    string
	hasCodeFence      bool
	isMeaningless     bool
	payloadBlockCount int
	listItemCount     int
	wasTruncated      bool

	payloadBoundaryEvidence payloadBoundaryEvidence
	payloadSplitConfidence  payloadSplitConfidence
}

// ModelCapabilityFeatures is intentionally separate from category and
// difficulty classification. It may be consumed by a future capability
// matcher without changing the routing classification pipeline.
type ModelCapabilityFeatures struct {
	inputTokenEstimate int
	toolIntent         bool
}

// ExtractPromptFeatures performs the common bounded preprocessing once. It
// deliberately contains no category or difficulty result fields.
func ExtractPromptFeatures(prompt string) PromptFeatures {
	scan := boundedRoutingTextSegments(prompt, maxCategoryScanBytes)
	normalizedParts := make([]string, 0, len(scan.segments))
	instructionParts := make([]string, 0, len(scan.segments))
	payloadParts := make([]string, 0, len(scan.segments))
	structuredInstructionParts := make([]string, 0, len(scan.segments))
	payloadBlockCount := 0
	hasCodeFence := false
	payloadState := routingPayloadBoundaryState{}
	payloadEvidence := payloadBoundaryEvidence(0)

	for _, segment := range scan.segments {
		canonical := canonicalizeRoutingText(segment)
		if normalizedPart := collapseRoutingWhitespace(canonical); normalizedPart != "" {
			normalizedParts = append(normalizedParts, normalizedPart)
		}

		if strings.Contains(canonical, "```") {
			hasCodeFence = true
		}
		split := splitRoutingExplicitPayloadBlocksFromState(canonical, payloadState)
		payloadState = split.state
		payloadBlockCount += split.openingCount
		payloadEvidence |= split.evidence
		instructionRaw := split.instruction
		payloadBlocks := split.payloadBlocks
		if instructionPart := collapseRoutingWhitespace(instructionRaw); instructionPart != "" {
			instructionParts = append(instructionParts, instructionPart)
		}
		if strings.TrimSpace(instructionRaw) != "" {
			structuredInstructionParts = append(structuredInstructionParts, instructionRaw)
		}
		for _, block := range payloadBlocks {
			if payloadPart := collapseRoutingWhitespace(block); payloadPart != "" {
				payloadParts = append(payloadParts, payloadPart)
			}
		}
	}

	normalized := strings.Join(normalizedParts, " ")
	instruction := strings.Join(instructionParts, " ")
	payload := strings.Join(payloadParts, "\n")
	structuredInstruction := strings.Join(structuredInstructionParts, "\n")
	meaningless := isMeaninglessRoutingText(normalized)
	listItemCount := countRoutingListItems(structuredInstruction)
	payloadConfidence := payloadSplitConfidenceNone
	if payloadBlockCount > 0 {
		payloadConfidence = payloadSplitConfidenceHigh
		if payloadState.kind == payloadBoundaryCodeFence || payloadState.kind == payloadBoundaryTag || payloadState.kind == payloadBoundaryBeginEnd {
			payloadConfidence = payloadSplitConfidenceLow
		}
	}
	return PromptFeatures{
		normalizedText:    normalized,
		instructionText:   instruction,
		payloadText:       payload,
		tokens:            routingTokenSet(normalized),
		instructionTokens: routingTokenSet(instruction),
		promptRuneLength:  utf8.RuneCountInString(prompt),
		wordCount:         len(strings.Fields(normalized)),
		clauseCount:       countRoutingClauses(structuredInstruction, meaningless),
		taskCount:         countRoutingTasks(structuredInstruction, meaningless),
		constraintCount:   countRoutingConstraints(instruction),
		scopeCount:        countRoutingScope(instruction, meaningless, payloadBlockCount, listItemCount),
		dependencyDepth:   countRoutingDependencyDepth(instruction),
		languageBucket:    routingLanguageBucket(normalized),
		hasCodeFence:      hasCodeFence,
		isMeaningless:     meaningless,
		payloadBlockCount: payloadBlockCount,
		listItemCount:     listItemCount,
		wasTruncated:      scan.truncated,

		payloadBoundaryEvidence: payloadEvidence,
		payloadSplitConfidence:  payloadConfidence,
	}
}

// ExtractModelCapabilityFeatures derives low-cardinality capability hints
// without adding them to PromptFeatures or the category/difficulty pipeline.
func ExtractModelCapabilityFeatures(features PromptFeatures) ModelCapabilityFeatures {
	return ModelCapabilityFeatures{
		inputTokenEstimate: estimateRoutingInputTokens(features.normalizedText),
		toolIntent: hasAnyPhrase(features.instructionText, []string{
			"use a tool", "call the tool", "browse", "search the web", "run the command",
			"도구를 사용", "도구 호출", "웹 검색", "검색해줘", "명령을 실행",
		}),
	}
}

func normalizeRoutingText(prompt string, maxBytes int) string {
	scan := boundedRoutingTextSegments(prompt, maxBytes)
	parts := make([]string, 0, len(scan.segments))
	for _, segment := range scan.segments {
		if normalized := collapseRoutingWhitespace(canonicalizeRoutingText(segment)); normalized != "" {
			parts = append(parts, normalized)
		}
	}
	return strings.Join(parts, " ")
}

type boundedRoutingScan struct {
	segments  []string
	truncated bool
}

func boundedRoutingTextSegments(prompt string, maxBytes int) boundedRoutingScan {
	if maxBytes <= 0 || len(prompt) <= maxBytes {
		return boundedRoutingScan{segments: []string{prompt}}
	}

	headBytes := maxBytes / 2
	tailBytes := maxBytes - headBytes
	head := validRoutingUTF8Prefix(prompt[:headBytes])
	tailStart := len(prompt) - tailBytes
	for tailStart < len(prompt) && !utf8.RuneStart(prompt[tailStart]) {
		tailStart++
	}
	tail := prompt[tailStart:]
	segments := make([]string, 0, 2)
	if head != "" {
		segments = append(segments, head)
	}
	if tail != "" {
		segments = append(segments, tail)
	}
	return boundedRoutingScan{segments: segments, truncated: true}
}

func validRoutingUTF8Prefix(text string) string {
	for !utf8.ValidString(text) && len(text) > 0 {
		text = text[:len(text)-1]
	}
	return text
}

func canonicalizeRoutingText(text string) string {
	text = strings.ToValidUTF8(text, "")
	text = norm.NFKC.String(text)
	text = strings.ToLower(text)
	return strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n")
}

func collapseRoutingWhitespace(text string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(text)), " ")
}

func routingTokenSet(text string) map[string]struct{} {
	tokens := strings.FieldsFunc(text, func(r rune) bool {
		return !(unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_')
	})
	result := make(map[string]struct{}, len(tokens))
	for _, token := range tokens {
		result[token] = struct{}{}
	}
	return result
}

func containsRoutingToken(tokens map[string]struct{}, target string) bool {
	if target == "" {
		return false
	}
	_, exists := tokens[target]
	return exists
}

func splitRoutingInstructionPayload(text string) (string, string) {
	instruction, payloadBlocks, _ := splitRoutingInstructionPayloadBlocks(text)
	return strings.TrimSpace(instruction), strings.TrimSpace(strings.Join(payloadBlocks, "\n"))
}

func splitRoutingInstructionPayloadBlocks(text string) (string, []string, int) {
	instruction, payloadBlocks, _, fenceCount, _ := splitRoutingInstructionPayloadBlocksFromState(text, false)
	return instruction, payloadBlocks, fenceCount
}

func splitRoutingInstructionPayloadBlocksFromState(text string, initialInPayload bool) (string, []string, bool, int, int) {
	instructionParts := make([]string, 0, 2)
	payloadParts := make([]string, 0, 2)
	inPayload := initialInPayload
	cursor := 0
	fenceCount := 0
	openingCount := 0

	for cursor <= len(text) {
		offset := strings.Index(text[cursor:], "```")
		if offset < 0 {
			appendRoutingTextPart(&instructionParts, &payloadParts, text[cursor:], inPayload)
			break
		}
		index := cursor + offset
		appendRoutingTextPart(&instructionParts, &payloadParts, text[cursor:index], inPayload)
		fenceCount++
		if !inPayload {
			openingCount++
		}
		inPayload = !inPayload
		cursor = index + len("```")
	}

	return strings.Join(instructionParts, "\n"), payloadParts, inPayload, fenceCount, openingCount
}

func appendRoutingTextPart(instructionParts *[]string, payloadParts *[]string, part string, inPayload bool) {
	if strings.TrimSpace(part) == "" {
		return
	}
	if inPayload {
		*payloadParts = append(*payloadParts, part)
		return
	}
	*instructionParts = append(*instructionParts, part)
}

type routingPayloadBoundaryState struct {
	kind     payloadBoundaryEvidence
	tagName  string
	tagDepth int
}

type routingPayloadSplitResult struct {
	instruction   string
	payloadBlocks []string
	state         routingPayloadBoundaryState
	openingCount  int
	evidence      payloadBoundaryEvidence
}

type routingBoundaryToken struct {
	start       int
	end         int
	kind        payloadBoundaryEvidence
	tagName     string
	closing     bool
	selfClosing bool
	instruction bool
	content     string
}

var routingExplicitTagPattern = regexp.MustCompile(`(?is)<\s*(/?)\s*(document|source|content|payload|attachment|instruction|instructions|task|request|처리할\s+원문|처리할\s+내용|원문|내용|자료|첨부|명령|지시|요청|작업)(\s+[^>]*)?>`)

func splitRoutingExplicitPayloadBlocksFromState(text string, initial routingPayloadBoundaryState) routingPayloadSplitResult {
	instructionParts := make([]string, 0, 2)
	payloadParts := make([]string, 0, 2)
	state := initial
	result := routingPayloadSplitResult{state: state}
	cursor := 0

	for cursor < len(text) {
		switch state.kind {
		case payloadBoundaryCodeFence:
			offset := strings.Index(text[cursor:], "```")
			if offset < 0 {
				appendRoutingTextPart(&instructionParts, &payloadParts, text[cursor:], true)
				cursor = len(text)
				continue
			}
			index := cursor + offset
			appendRoutingTextPart(&instructionParts, &payloadParts, text[cursor:index], true)
			state = routingPayloadBoundaryState{}
			cursor = index + len("```")
			continue
		case payloadBoundaryTag:
			closeStart, closeEnd, nextDepth, found := findRoutingPayloadTagClose(text, cursor, state.tagName, state.tagDepth)
			state.tagDepth = nextDepth
			if !found {
				appendRoutingTextPart(&instructionParts, &payloadParts, text[cursor:], true)
				cursor = len(text)
				continue
			}
			appendRoutingTextPart(&instructionParts, &payloadParts, text[cursor:closeStart], true)
			state = routingPayloadBoundaryState{}
			cursor = closeEnd
			continue
		case payloadBoundaryHeading:
			heading, found := nextRoutingRoleHeading(text, cursor)
			if !found {
				appendRoutingTextPart(&instructionParts, &payloadParts, text[cursor:], true)
				cursor = len(text)
				continue
			}
			appendRoutingTextPart(&instructionParts, &payloadParts, text[cursor:heading.start], true)
			if heading.instruction {
				state = routingPayloadBoundaryState{}
			} else {
				result.openingCount++
				result.evidence |= payloadBoundaryHeading
			}
			cursor = heading.end
			continue
		case payloadBoundaryBeginEnd:
			closeStart, closeEnd, nextDepth, found := findRoutingBeginEndClose(text, cursor, state.tagName, state.tagDepth)
			state.tagDepth = nextDepth
			if !found {
				appendRoutingTextPart(&instructionParts, &payloadParts, text[cursor:], true)
				cursor = len(text)
				continue
			}
			appendRoutingTextPart(&instructionParts, &payloadParts, text[cursor:closeStart], true)
			state = routingPayloadBoundaryState{}
			cursor = closeEnd
			continue
		case payloadBoundaryCue:
			appendRoutingTextPart(&instructionParts, &payloadParts, text[cursor:], true)
			cursor = len(text)
			continue
		}

		token, found := nextRoutingBoundaryToken(text, cursor)
		if !found {
			appendRoutingTextPart(&instructionParts, &payloadParts, text[cursor:], false)
			cursor = len(text)
			continue
		}
		appendRoutingTextPart(&instructionParts, &payloadParts, text[cursor:token.start], false)
		marker := text[token.start:token.end]
		switch {
		case token.kind == payloadBoundaryCodeFence:
			state = routingPayloadBoundaryState{kind: payloadBoundaryCodeFence}
			result.openingCount++
			result.evidence |= payloadBoundaryCodeFence
		case token.kind == payloadBoundaryHeading && token.instruction:
			// A role heading is a structural wrapper, like an instruction tag.
		case token.kind == payloadBoundaryHeading:
			state = routingPayloadBoundaryState{kind: payloadBoundaryHeading}
			result.openingCount++
			result.evidence |= payloadBoundaryHeading
		case token.kind == payloadBoundaryBeginEnd && token.instruction:
			// Instruction BEGIN/END markers are structural wrappers.
		case token.kind == payloadBoundaryBeginEnd && token.closing:
			// A closing marker without a matching opening marker is ordinary
			// instruction text; it must not create a payload boundary.
			appendRoutingTextPart(&instructionParts, &payloadParts, marker, false)
		case token.kind == payloadBoundaryBeginEnd:
			state = routingPayloadBoundaryState{kind: payloadBoundaryBeginEnd, tagName: token.tagName, tagDepth: 1}
			result.openingCount++
			result.evidence |= payloadBoundaryBeginEnd
		case token.kind == payloadBoundaryBlockQuote:
			appendRoutingTextPart(&instructionParts, &payloadParts, token.content, true)
			result.openingCount++
			result.evidence |= payloadBoundaryBlockQuote
		case token.kind == payloadBoundaryCue:
			state = routingPayloadBoundaryState{kind: payloadBoundaryCue}
			result.openingCount++
			result.evidence |= payloadBoundaryCue
		case token.instruction:
			// Instruction role tags are structural wrappers. Their content stays
			// in the instruction stream while the marker itself is removed.
		case token.closing || token.selfClosing:
			appendRoutingTextPart(&instructionParts, &payloadParts, marker, false)
		default:
			state = routingPayloadBoundaryState{kind: payloadBoundaryTag, tagName: token.tagName, tagDepth: 1}
			result.openingCount++
			result.evidence |= payloadBoundaryTag
		}
		cursor = token.end
	}

	result.instruction = strings.Join(instructionParts, "\n")
	result.payloadBlocks = payloadParts
	result.state = state
	return result
}

func nextRoutingBoundaryToken(text string, cursor int) (routingBoundaryToken, bool) {
	fenceStart := strings.Index(text[cursor:], "```")
	if fenceStart >= 0 {
		fenceStart += cursor
	}
	tagIndexes := routingExplicitTagPattern.FindStringSubmatchIndex(text[cursor:])
	tagStart := -1
	if tagIndexes != nil {
		tagStart = cursor + tagIndexes[0]
	}
	heading, hasHeading := nextRoutingRoleHeading(text, cursor)
	headingStart := -1
	if hasHeading {
		headingStart = heading.start
	}
	beginEnd, hasBeginEnd := nextRoutingBeginEndMarker(text, cursor)
	beginEndStart := -1
	if hasBeginEnd {
		beginEndStart = beginEnd.start
	}
	blockQuote, hasBlockQuote := nextRoutingBlockQuote(text, cursor)
	blockQuoteStart := -1
	if hasBlockQuote {
		blockQuoteStart = blockQuote.start
	}
	cue, hasCue := nextRoutingLimitedCue(text, cursor)
	cueStart := -1
	if hasCue {
		cueStart = cue.start
	}
	if fenceStart >= 0 && (tagStart < 0 || fenceStart < tagStart) && (headingStart < 0 || fenceStart < headingStart) && (beginEndStart < 0 || fenceStart < beginEndStart) && (blockQuoteStart < 0 || fenceStart < blockQuoteStart) && (cueStart < 0 || fenceStart < cueStart) {
		return routingBoundaryToken{start: fenceStart, end: fenceStart + len("```"), kind: payloadBoundaryCodeFence}, true
	}
	if hasHeading && (tagStart < 0 || headingStart < tagStart) && (beginEndStart < 0 || headingStart < beginEndStart) && (blockQuoteStart < 0 || headingStart < blockQuoteStart) && (cueStart < 0 || headingStart < cueStart) {
		return heading, true
	}
	if hasBeginEnd && (tagStart < 0 || beginEndStart < tagStart) && (blockQuoteStart < 0 || beginEndStart < blockQuoteStart) && (cueStart < 0 || beginEndStart < cueStart) {
		return beginEnd, true
	}
	if hasBlockQuote && (tagStart < 0 || blockQuoteStart < tagStart) && (cueStart < 0 || blockQuoteStart < cueStart) {
		return blockQuote, true
	}
	if hasCue && (tagStart < 0 || cueStart < tagStart) {
		return cue, true
	}
	if tagIndexes == nil {
		return routingBoundaryToken{}, false
	}
	for index := range tagIndexes {
		if tagIndexes[index] >= 0 {
			tagIndexes[index] += cursor
		}
	}
	marker := text[tagIndexes[0]:tagIndexes[1]]
	tagName := normalizeRoutingRoleLabel(text[tagIndexes[4]:tagIndexes[5]])
	closing := tagIndexes[2] >= 0 && strings.TrimSpace(text[tagIndexes[2]:tagIndexes[3]]) == "/"
	trimmedMarker := strings.TrimSpace(marker)
	selfClosing := strings.HasSuffix(strings.TrimSpace(strings.TrimSuffix(trimmedMarker, ">")), "/")
	return routingBoundaryToken{
		start:       tagIndexes[0],
		end:         tagIndexes[1],
		kind:        payloadBoundaryTag,
		tagName:     tagName,
		closing:     closing,
		selfClosing: selfClosing,
		instruction: isRoutingInstructionTag(tagName),
	}, true
}

func nextRoutingLimitedCue(text string, cursor int) (routingBoundaryToken, bool) {
	search := cursor
	for search < len(text) {
		offset := strings.IndexAny(text[search:], ":：")
		if offset < 0 {
			return routingBoundaryToken{}, false
		}
		colonStart := search + offset
		_, colonWidth := utf8.DecodeRuneInString(text[colonStart:])
		payloadStart := colonStart + colonWidth
		lineStart := strings.LastIndexByte(text[:colonStart], '\n') + 1
		clause := strings.TrimSpace(text[lineStart:colonStart])
		if strings.TrimSpace(text[payloadStart:]) != "" && hasApprovedRoutingPayloadAction(clause) && hasRoutingLimitedCueObject(clause) {
			return routingBoundaryToken{
				start: payloadStart,
				end:   payloadStart,
				kind:  payloadBoundaryCue,
			}, true
		}
		search = payloadStart
	}
	return routingBoundaryToken{}, false
}

func hasRoutingLimitedCueObject(text string) bool {
	return hasAnyPhrase(text, []string{
		"following content", "following text",
		"content below", "text below", "below content", "below text",
		"다음 내용", "다음 원문", "다음 자료",
		"아래 내용", "아래 원문", "아래 자료",
	})
}

func nextRoutingBlockQuote(text string, cursor int) (routingBoundaryToken, bool) {
	lineStart := cursor
	if lineStart > 0 && text[lineStart-1] != '\n' {
		if offset := strings.IndexByte(text[lineStart:], '\n'); offset >= 0 {
			lineStart += offset + 1
		} else {
			return routingBoundaryToken{}, false
		}
	}

	for lineStart < len(text) {
		lineEnd, tokenEnd := routingLineBounds(text, lineStart)
		content, quoted := routingBlockQuoteLine(text[lineStart:lineEnd])
		if !quoted {
			lineStart = tokenEnd
			continue
		}

		blockStart := lineStart
		blockEnd := tokenEnd
		contents := []string{content}
		for blockEnd < len(text) {
			nextLineEnd, nextTokenEnd := routingLineBounds(text, blockEnd)
			nextContent, nextQuoted := routingBlockQuoteLine(text[blockEnd:nextLineEnd])
			if !nextQuoted {
				break
			}
			contents = append(contents, nextContent)
			blockEnd = nextTokenEnd
		}

		outside := text[:blockStart] + "\n" + text[blockEnd:]
		if collapseRoutingWhitespace(outside) != "" && hasApprovedRoutingPayloadAction(outside) {
			return routingBoundaryToken{
				start:   blockStart,
				end:     blockEnd,
				kind:    payloadBoundaryBlockQuote,
				content: strings.Join(contents, "\n"),
			}, true
		}
		lineStart = blockEnd
	}
	return routingBoundaryToken{}, false
}

func routingLineBounds(text string, lineStart int) (int, int) {
	if offset := strings.IndexByte(text[lineStart:], '\n'); offset >= 0 {
		lineEnd := lineStart + offset
		return lineEnd, lineEnd + 1
	}
	return len(text), len(text)
}

func routingBlockQuoteLine(line string) (string, bool) {
	trimmedLeft := strings.TrimLeft(line, " \t")
	if !strings.HasPrefix(trimmedLeft, ">") {
		return "", false
	}
	content := strings.TrimPrefix(trimmedLeft, ">")
	content = strings.TrimPrefix(content, " ")
	return content, true
}

func hasApprovedRoutingPayloadAction(text string) bool {
	return hasAnyPhrase(text, []string{
		"summarize", "summarise", "condense",
		"translate", "localize", "localise",
		"analyze", "analyse", "review", "extract", "compare", "explain",
		"fix", "debug", "refactor",
		"요약", "압축", "정리", "번역", "현지화", "분석", "검토", "추출", "비교", "설명", "수정", "디버깅", "리팩터링",
	})
}

func nextRoutingBeginEndMarker(text string, cursor int) (routingBoundaryToken, bool) {
	lineStart := cursor
	if lineStart > 0 && text[lineStart-1] != '\n' {
		if offset := strings.IndexByte(text[lineStart:], '\n'); offset >= 0 {
			lineStart += offset + 1
		} else {
			return routingBoundaryToken{}, false
		}
	}

	for lineStart <= len(text) {
		lineEnd := len(text)
		tokenEnd := lineEnd
		if offset := strings.IndexByte(text[lineStart:], '\n'); offset >= 0 {
			lineEnd = lineStart + offset
			tokenEnd = lineEnd + 1
		}
		if role, closing, ok := routingBeginEndRole(text[lineStart:lineEnd]); ok {
			return routingBoundaryToken{
				start:       lineStart,
				end:         tokenEnd,
				kind:        payloadBoundaryBeginEnd,
				tagName:     role,
				closing:     closing,
				instruction: isRoutingInstructionRole(role),
			}, true
		}
		if tokenEnd >= len(text) {
			break
		}
		lineStart = tokenEnd
	}
	return routingBoundaryToken{}, false
}

func routingBeginEndRole(line string) (string, bool, bool) {
	marker := strings.TrimSpace(line)
	if len(marker) >= 2 && marker[0] == '[' && marker[len(marker)-1] == ']' {
		marker = strings.TrimSpace(marker[1 : len(marker)-1])
	} else {
		marker = strings.TrimSpace(strings.Trim(marker, "-="))
	}

	for _, candidate := range []struct {
		prefix  string
		suffix  string
		closing bool
	}{
		{prefix: "begin ", closing: false},
		{prefix: "end ", closing: true},
		{suffix: " 시작", closing: false},
		{suffix: " 끝", closing: true},
	} {
		role := ""
		switch {
		case candidate.prefix != "" && strings.HasPrefix(marker, candidate.prefix):
			role = strings.TrimSpace(strings.TrimPrefix(marker, candidate.prefix))
		case candidate.suffix != "" && strings.HasSuffix(marker, candidate.suffix):
			role = strings.TrimSpace(strings.TrimSuffix(marker, candidate.suffix))
		default:
			continue
		}
		role = normalizeRoutingRoleLabel(role)
		if isRoutingInstructionRole(role) || isRoutingPayloadRole(role) {
			return role, candidate.closing, true
		}
	}
	return "", false, false
}

func nextRoutingRoleHeading(text string, cursor int) (routingBoundaryToken, bool) {
	lineStart := cursor
	if lineStart > 0 && text[lineStart-1] != '\n' {
		if offset := strings.IndexByte(text[lineStart:], '\n'); offset >= 0 {
			lineStart += offset + 1
		} else {
			return routingBoundaryToken{}, false
		}
	}

	for lineStart <= len(text) {
		lineEnd := len(text)
		tokenEnd := lineEnd
		if offset := strings.IndexByte(text[lineStart:], '\n'); offset >= 0 {
			lineEnd = lineStart + offset
			tokenEnd = lineEnd + 1
		}
		if role, ok := routingHeadingRole(text[lineStart:lineEnd]); ok {
			return routingBoundaryToken{
				start:       lineStart,
				end:         tokenEnd,
				kind:        payloadBoundaryHeading,
				instruction: isRoutingInstructionRole(role),
				tagName:     role,
			}, true
		}
		if tokenEnd >= len(text) {
			break
		}
		lineStart = tokenEnd
	}
	return routingBoundaryToken{}, false
}

func routingHeadingRole(line string) (string, bool) {
	marker := strings.TrimSpace(line)
	if len(marker) >= 2 && marker[0] == '[' && marker[len(marker)-1] == ']' {
		marker = strings.TrimSpace(marker[1 : len(marker)-1])
	} else if strings.HasPrefix(marker, "#") {
		hashCount := 0
		for hashCount < len(marker) && marker[hashCount] == '#' {
			hashCount++
		}
		if hashCount > 6 || hashCount == len(marker) || !unicode.IsSpace(rune(marker[hashCount])) {
			return "", false
		}
		marker = strings.TrimSpace(marker[hashCount:])
		marker = strings.TrimSpace(strings.TrimRight(marker, "#"))
	} else if strings.HasSuffix(marker, ":") || strings.HasSuffix(marker, "：") {
		marker = strings.TrimSpace(strings.TrimSuffix(strings.TrimSuffix(marker, ":"), "："))
	} else {
		return "", false
	}

	role := normalizeRoutingRoleLabel(marker)
	if !isRoutingInstructionRole(role) && !isRoutingPayloadRole(role) {
		return "", false
	}
	return role, true
}

func findRoutingPayloadTagClose(text string, cursor int, tagName string, initialDepth int) (int, int, int, bool) {
	depth := initialDepth
	search := cursor
	for search < len(text) {
		indexes := routingExplicitTagPattern.FindStringSubmatchIndex(text[search:])
		if indexes == nil {
			return 0, 0, depth, false
		}
		for index := range indexes {
			if indexes[index] >= 0 {
				indexes[index] += search
			}
		}
		name := normalizeRoutingRoleLabel(text[indexes[4]:indexes[5]])
		if name != tagName {
			search = indexes[1]
			continue
		}
		marker := text[indexes[0]:indexes[1]]
		closing := indexes[2] >= 0 && strings.TrimSpace(text[indexes[2]:indexes[3]]) == "/"
		selfClosing := strings.HasSuffix(strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(marker), ">")), "/")
		switch {
		case selfClosing:
		case closing:
			depth--
			if depth == 0 {
				return indexes[0], indexes[1], depth, true
			}
		default:
			depth++
		}
		search = indexes[1]
	}
	return 0, 0, depth, false
}

func findRoutingBeginEndClose(text string, cursor int, role string, initialDepth int) (int, int, int, bool) {
	depth := initialDepth
	search := cursor
	for search < len(text) {
		marker, found := nextRoutingBeginEndMarker(text, search)
		if !found {
			return 0, 0, depth, false
		}
		if marker.tagName != role {
			search = marker.end
			continue
		}
		if marker.closing {
			depth--
			if depth == 0 {
				return marker.start, marker.end, depth, true
			}
		} else {
			depth++
		}
		search = marker.end
	}
	return 0, 0, depth, false
}

func isRoutingInstructionTag(tagName string) bool {
	return isRoutingInstructionRole(normalizeRoutingRoleLabel(tagName))
}

func normalizeRoutingRoleLabel(role string) string {
	return collapseRoutingWhitespace(strings.ToLower(strings.TrimSpace(role)))
}

func isRoutingInstructionRole(role string) bool {
	switch role {
	case "instruction", "instructions", "task", "request", "명령", "지시", "요청", "작업":
		return true
	default:
		return false
	}
}

func isRoutingPayloadRole(role string) bool {
	switch role {
	case "document", "source", "content", "payload", "attachment", "원문", "처리할 원문", "처리할 내용", "내용", "자료", "첨부":
		return true
	default:
		return false
	}
}

func isMeaninglessRoutingText(text string) bool {
	if text == "" {
		return true
	}
	meaningful := 0
	for _, r := range text {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			meaningful++
		}
	}
	if meaningful == 0 {
		return true
	}
	switch text {
	case "test", "n/a", "na", "[redacted]", "[masked]":
		return true
	default:
		return false
	}
}

func countRoutingClauses(text string, meaningless bool) int {
	if meaningless || text == "" {
		return 0
	}
	count := len(splitRoutingInstructionUnits(text))
	if count == 0 {
		count = 1
	}
	return minInt(count, 8)
}

func countRoutingTasks(text string, meaningless bool) int {
	if meaningless || text == "" {
		return 0
	}

	actions := []string{
		"explain", "show", "find", "fix", "debug", "refactor", "design", "implement",
		"translate", "localize", "summarize", "compare", "recommend", "evaluate", "analyze",
		"extract", "create", "produce", "generate", "write", "propose", "investigate", "decide",
		"설명", "알려", "보여", "찾아", "수정", "고쳐", "디버깅", "리팩터링", "리팩토링",
		"설계", "구현", "번역", "영문화", "현지화", "요약", "압축", "비교", "추천",
		"평가", "분석", "추출", "생성", "만들", "작성", "제안", "조사", "판단", "결정",
	}
	count := 0
	seenUnits := make(map[string]struct{})
	for _, unit := range splitRoutingInstructionUnits(text) {
		if !hasAnyPhrase(unit, actions) {
			continue
		}
		if _, exists := seenUnits[unit]; exists {
			continue
		}
		seenUnits[unit] = struct{}{}
		count++
	}
	if count == 0 {
		return 1
	}
	return minInt(count, 6)
}

func countRoutingConstraints(text string) int {
	targetFamilies := [][]string{
		{"format", "formatting", "형식", "포맷"},
		{"tone", "말투", "톤", "존댓말", "반말"},
		{"terminology", "term", "용어", "전문용어", "전문 용어"},
		{"compatibility", "compatible", "호환"},
		{"security", "secure", "보안"},
		{"performance", "latency", "성능", "지연"},
		{"test boundary", "테스트 경계"},
	}
	operatorFamilies := [][]string{
		{"constraint", "constraints", "제약", "조건"},
		{"preserve", "preserving", "maintain", "유지", "보존"},
		{"must", "required", "반드시"},
		{"without", "없이"},
	}
	targetCount := countMatchedRoutingPhraseFamilies(text, targetFamilies)
	if hasRoutingLimitConstraint(text) {
		targetCount++
	}
	if targetCount > 0 {
		return minInt(targetCount, 6)
	}
	return minInt(countMatchedRoutingPhraseFamilies(text, operatorFamilies), 6)
}

func countRoutingScope(text string, meaningless bool, explicitSourceCount int, listItemCount int) int {
	if meaningless || (text == "" && explicitSourceCount == 0 && listItemCount == 0) {
		return 0
	}

	count := maxInt(1, maxInt(explicitSourceCount, listItemCount))
	for _, candidate := range []struct {
		phrases []string
		count   int
	}{
		{phrases: []string{"two files", "two documents", "two options", "두 파일", "두 문서", "두 대안", "두 방식"}, count: 2},
		{phrases: []string{"multiple files", "multiple documents", "multiple options", "several files", "several documents", "여러 파일", "여러 문서", "여러 대안", "여러 언어", "여러 시스템"}, count: 2},
		{phrases: []string{"three files", "three documents", "three options", "세 파일", "세 문서", "세 대안", "세 가지"}, count: 3},
		{phrases: []string{"four files", "four documents", "four options", "네 파일", "네 문서", "네 대안", "네 가지"}, count: 4},
		{phrases: []string{"five files", "five documents", "five options", "다섯 파일", "다섯 문서", "다섯 대안", "다섯 가지"}, count: 5},
		{phrases: []string{"six files", "six documents", "six options", "여섯 파일", "여섯 문서", "여섯 대안", "여섯 가지"}, count: 6},
	} {
		if hasAnyPhrase(text, candidate.phrases) && candidate.count > count {
			count = candidate.count
		}
	}
	if numericCount := routingNumericScopeCount(text); numericCount > count {
		count = numericCount
	}
	if routingNamedPairPattern.MatchString(text) || routingNamedOptionPairPattern.MatchString(text) {
		count = maxInt(count, 2)
	}
	return minInt(count, 6)
}

func countRoutingDependencyDepth(text string) int {
	families := [][]string{
		{"then", "after", "before", "그다음", "이후", "먼저", "한 뒤"},
		{"if", "unless", "otherwise", "경우", "실패 시"},
		{"fallback", "복구 경로", "대체 경로"},
		{"step", "stage", "단계", "순서"},
	}
	units := strings.FieldsFunc(text, func(r rune) bool {
		switch r {
		case '\n', ',', ';', '.', '?', '!':
			return true
		default:
			return false
		}
	})
	count := 0
	for _, unit := range units {
		for _, family := range families {
			if hasAnyPhrase(unit, family) {
				count++
			}
		}
	}
	return minInt(count, 5)
}

func routingLanguageBucket(text string) string {
	hasKorean := false
	hasLatin := false
	for _, r := range text {
		switch {
		case unicode.In(r, unicode.Hangul):
			hasKorean = true
		case unicode.Is(unicode.Latin, r):
			hasLatin = true
		}
	}
	switch {
	case hasKorean && hasLatin:
		return "mixed"
	case hasKorean:
		return "ko"
	case hasLatin:
		return "en"
	default:
		return "unknown"
	}
}

func estimateRoutingInputTokens(text string) int {
	if text == "" {
		return 0
	}
	latinRunes := 0
	otherRunes := 0
	for _, r := range text {
		if unicode.IsSpace(r) {
			continue
		}
		if unicode.Is(unicode.Latin, r) || unicode.IsDigit(r) {
			latinRunes++
		} else {
			otherRunes++
		}
	}
	return (latinRunes+3)/4 + (otherRunes+1)/2
}

func countDistinctPhrases(text string, phrases []string) int {
	count := 0
	for _, phrase := range phrases {
		if containsRoutingPhrase(text, phrase) {
			count++
		}
	}
	return count
}

func countDistinctPhrasesIncludingBoundaries(text string, phrases []string) int {
	return countDistinctPhrases(text, phrases)
}

func containsRoutingPhrase(text string, phrase string) bool {
	phrase = strings.TrimSpace(phrase)
	if phrase == "" || text == "" {
		return false
	}

	useWordBoundaries := !containsHangulRune(phrase)
	searchStart := 0
	for searchStart <= len(text)-len(phrase) {
		offset := strings.Index(text[searchStart:], phrase)
		if offset < 0 {
			break
		}
		start := searchStart + offset
		end := start + len(phrase)
		if !useWordBoundaries || routingPhraseHasWordBoundaries(text, start, end, phrase) {
			return true
		}
		_, width := utf8.DecodeRuneInString(text[start:])
		if width <= 0 {
			width = 1
		}
		searchStart = start + width
	}
	return false
}

func routingPhraseHasWordBoundaries(text string, start int, end int, phrase string) bool {
	first, _ := utf8.DecodeRuneInString(phrase)
	last, _ := utf8.DecodeLastRuneInString(phrase)
	if isRoutingWordRune(first) && start > 0 {
		previous, _ := utf8.DecodeLastRuneInString(text[:start])
		if isRoutingWordRune(previous) {
			return false
		}
	}
	if isRoutingWordRune(last) && end < len(text) {
		next, _ := utf8.DecodeRuneInString(text[end:])
		if isRoutingWordRune(next) && !hasBoundedRoutingInflection(text[end:]) {
			return false
		}
	}
	return true
}

func hasBoundedRoutingInflection(remainder string) bool {
	for _, suffix := range []string{"ing", "ed", "es", "s"} {
		if !strings.HasPrefix(remainder, suffix) {
			continue
		}
		end := len(suffix)
		if end == len(remainder) {
			return true
		}
		next, _ := utf8.DecodeRuneInString(remainder[end:])
		if !isRoutingWordRune(next) {
			return true
		}
	}
	return false
}

func isRoutingWordRune(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_'
}

func containsHangulRune(text string) bool {
	for _, r := range text {
		if unicode.In(r, unicode.Hangul) {
			return true
		}
	}
	return false
}

func countMatchedRoutingPhraseFamilies(text string, families [][]string) int {
	count := 0
	for _, family := range families {
		if hasAnyPhrase(text, family) {
			count++
		}
	}
	return count
}

func splitRoutingInstructionUnits(text string) []string {
	baseSegments := strings.FieldsFunc(text, func(r rune) bool {
		switch r {
		case '\n', ';', '.', '?', '!':
			return true
		default:
			return false
		}
	})
	separators := []string{" and then ", " then ", " and ", " 그리고 ", " 그다음 ", " 한 뒤 ", " 이후 ", "하고 ", "하며 ", "하면서 "}
	units := make([]string, 0, len(baseSegments))
	for _, segment := range baseSegments {
		parts := []string{collapseRoutingWhitespace(stripRoutingListMarker(segment))}
		for _, separator := range separators {
			next := make([]string, 0, len(parts))
			for _, part := range parts {
				next = append(next, strings.Split(part, separator)...)
			}
			parts = next
		}
		for _, part := range parts {
			if part = collapseRoutingWhitespace(part); part != "" {
				units = append(units, part)
			}
		}
	}
	return units
}

func countRoutingListItems(text string) int {
	count := 0
	for _, line := range strings.Split(text, "\n") {
		if _, matched := routingListItemContent(line); matched {
			count++
		}
	}
	return minInt(count, 6)
}

func stripRoutingListMarker(text string) string {
	content, _ := routingListItemContent(text)
	return content
}

func routingListItemContent(text string) (string, bool) {
	trimmed := strings.TrimSpace(text)
	if len(trimmed) >= 2 && strings.ContainsRune("-*+", rune(trimmed[0])) && unicode.IsSpace(rune(trimmed[1])) {
		return strings.TrimSpace(trimmed[1:]), true
	}
	fields := strings.Fields(trimmed)
	if len(fields) < 2 {
		return trimmed, false
	}
	marker := fields[0]
	if len(marker) < 2 || (marker[len(marker)-1] != '.' && marker[len(marker)-1] != ')') {
		return trimmed, false
	}
	label := marker[:len(marker)-1]
	if _, err := strconv.Atoi(label); err == nil {
		return strings.TrimSpace(strings.TrimPrefix(trimmed, marker)), true
	}
	if utf8.RuneCountInString(label) == 1 {
		labelRune, _ := utf8.DecodeRuneInString(label)
		if unicode.IsLetter(labelRune) {
			return strings.TrimSpace(strings.TrimPrefix(trimmed, marker)), true
		}
	}
	return trimmed, false
}

var (
	routingEnglishNumericScopePattern = regexp.MustCompile(`(?i)\b([2-9]|[1-9][0-9])\s+(?:files?|documents?|options?|alternatives?|languages?|systems?|sources?)\b`)
	routingKoreanNumericScopePattern  = regexp.MustCompile(`([2-9]|[1-9][0-9])\s*개?\s*(?:파일|문서|대안|방식|언어|시스템|자료|소스)`)
	routingNamedPairPattern           = regexp.MustCompile(`(?i)\b[a-z]\s*(?:와|과|및|and|&)\s*[a-z]\b`)
	routingNamedOptionPairPattern     = regexp.MustCompile(`(?i)\b[a-z](?:안|plan|option)\s*(?:와|과|및|and|&)\s*[a-z](?:안|plan|option)`)
	routingEnglishLimitPattern        = regexp.MustCompile(`(?i)\b(?:under|within)\s+\d+(?:\.\d+)?(?:\s*[a-z]+)?\b`)
	routingKoreanLimitPattern         = regexp.MustCompile(`\d+(?:\.\d+)?\s*(?:자|개|초|분|시간|토큰|단어|문장|줄|kb|mb)?\s*이내`)
)

func routingNumericScopeCount(text string) int {
	count := 0
	for _, pattern := range []*regexp.Regexp{routingEnglishNumericScopePattern, routingKoreanNumericScopePattern} {
		for _, match := range pattern.FindAllStringSubmatch(text, -1) {
			if len(match) < 2 {
				continue
			}
			value, err := strconv.Atoi(match[1])
			if err == nil && value > count {
				count = value
			}
		}
	}
	return minInt(count, 6)
}

func hasRoutingLimitConstraint(text string) bool {
	return routingEnglishLimitPattern.MatchString(text) || routingKoreanLimitPattern.MatchString(text)
}

func minInt(left int, right int) int {
	if left < right {
		return left
	}
	return right
}
