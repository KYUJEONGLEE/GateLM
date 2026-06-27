package routing

type Request struct {
	RequestedModel string
	PromptText     string
	Config         *SimpleRouterConfig
}

type Decision struct {
	RequestedModel   string
	SelectedProvider string
	SelectedModel    string
	RoutingReason    string
	PolicyHash       string
}
