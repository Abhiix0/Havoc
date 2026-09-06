package domain

type Remediation struct {
	Title        string   `json:"title"`
	WhatHappened string   `json:"whatHappened"`
	WhyItMatters string   `json:"whyItMatters"`
	HowToFix     []string `json:"howToFix"`
	FixPrompt    string   `json:"fixPrompt"`
}
