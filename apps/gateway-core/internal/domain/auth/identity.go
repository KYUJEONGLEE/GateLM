package auth

type APIKeyIdentity struct {
	APIKeyID      string
	TenantID      string
	ProjectID     string
	ApplicationID string
}

type AppTokenIdentity struct {
	AppTokenID    string
	TenantID      string
	ProjectID     string
	ApplicationID string
}
