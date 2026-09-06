package domain

import (
	"fmt"
	"regexp"
	"strings"
)

var (
	awsKeyRegex    = regexp.MustCompile(`AKIA[0-9A-Z]{16}`)
	privateKeyRegex = regexp.MustCompile(`-----BEGIN[ A-Z0-9_-]*PRIVATE KEY-----`)
)

type FieldViolation struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

type ValidationError struct {
	Violations []FieldViolation `json:"violations"`
}

func (v *ValidationError) Error() string {
	if len(v.Violations) == 0 {
		return "validation failed"
	}
	var msgs []string
	for _, f := range v.Violations {
		msgs = append(msgs, fmt.Sprintf("%s: %s", f.Field, f.Message))
	}
	return "validation failed: " + strings.Join(msgs, "; ")
}

func (v *ValidationError) Add(field, message string) {
	v.Violations = append(v.Violations, FieldViolation{
		Field:   field,
		Message: message,
	})
}

const maxStringLength = 10000

func checkString(v *ValidationError, field, value string) {
	if len(value) > maxStringLength {
		v.Add(field, fmt.Sprintf("field exceeds maximum length of %d characters", maxStringLength))
	}
	if awsKeyRegex.MatchString(value) {
		v.Add(field, "field contains sensitive AWS key pattern")
	}
	if privateKeyRegex.MatchString(value) {
		v.Add(field, "field contains sensitive private key pattern")
	}
}

func ValidateShipCheckIngest(sc ShipCheck, findings []Finding) error {
	v := &ValidationError{}

	if strings.TrimSpace(sc.ClientShipCheckID) == "" {
		v.Add("clientShipCheckId", "clientShipCheckId is required")
	} else {
		checkString(v, "clientShipCheckId", sc.ClientShipCheckID)
	}

	if strings.TrimSpace(sc.TargetOrigin) == "" {
		v.Add("targetOrigin", "targetOrigin is required")
	} else {
		checkString(v, "targetOrigin", sc.TargetOrigin)
	}

	if !sc.Readiness.Valid() {
		v.Add("readiness", fmt.Sprintf("invalid readiness value: %q", sc.Readiness))
	}

	for i, step := range sc.Steps {
		stepField := fmt.Sprintf("steps[%d]", i)
		checkString(v, stepField+".kind", step.Kind)
		if !step.Status.Valid() {
			v.Add(stepField+".status", fmt.Sprintf("invalid step status: %q", step.Status))
		}
	}

	for i, finding := range findings {
		fPrefix := fmt.Sprintf("findings[%d]", i)

		checkString(v, fPrefix+".clientFindingId", finding.ClientFindingID)
		checkString(v, fPrefix+".checkKind", finding.CheckKind)
		checkString(v, fPrefix+".description", finding.Description)

		if !finding.Severity.Valid() {
			v.Add(fPrefix+".severity", fmt.Sprintf("invalid severity value: %q", finding.Severity))
		}

		if finding.Confidence < 0.0 || finding.Confidence > 1.0 {
			v.Add(fPrefix+".confidence", fmt.Sprintf("confidence must be between 0.0 and 1.0, got %f", finding.Confidence))
		}

		if (finding.Severity == SeverityHigh || finding.Severity == SeverityMedium) && len(finding.Evidence) == 0 {
			v.Add(fPrefix+".evidence", fmt.Sprintf("evidence is required for %s severity finding", finding.Severity))
		}

		for j, ev := range finding.Evidence {
			evPrefix := fmt.Sprintf("%s.evidence[%d]", fPrefix, j)
			checkString(v, evPrefix+".kind", ev.Kind)
			checkString(v, evPrefix+".refId", ev.RefID)
		}

		if finding.Remediation != nil {
			rPrefix := fPrefix + ".remediation"
			checkString(v, rPrefix+".title", finding.Remediation.Title)
			checkString(v, rPrefix+".whatHappened", finding.Remediation.WhatHappened)
			checkString(v, rPrefix+".whyItMatters", finding.Remediation.WhyItMatters)
			checkString(v, rPrefix+".fixPrompt", finding.Remediation.FixPrompt)
			for k, fix := range finding.Remediation.HowToFix {
				checkString(v, fmt.Sprintf("%s.howToFix[%d]", rPrefix, k), fix)
			}
		}
	}

	if len(v.Violations) > 0 {
		return v
	}

	return nil
}
