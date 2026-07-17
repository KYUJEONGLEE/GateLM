package workloadauth

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"os"
	"strings"

	"gatelm/apps/gateway-core/internal/domain/ragembedding"
)

const maximumConfigBytes = 1 << 20

type jwksDocument struct {
	Keys []struct {
		KTY string `json:"kty"`
		CRV string `json:"crv"`
		Alg string `json:"alg"`
		Use string `json:"use"`
		KID string `json:"kid"`
		X   string `json:"x"`
	} `json:"keys"`
}

type bindingKeysDocument struct {
	Keys []struct {
		KID string `json:"kid"`
		Key string `json:"key"`
	} `json:"keys"`
}

type identitiesDocument struct {
	Identities []struct {
		KID             string                 `json:"kid"`
		Issuer          string                 `json:"issuer"`
		Subject         string                 `json:"subject"`
		AllowedPurposes []ragembedding.Purpose `json:"allowedPurposes"`
	} `json:"identities"`
}

func Load(jwksPath, bindingKeysPath, identitiesPath string) (*Verifier, error) {
	publicKeys, err := loadPublicKeys(jwksPath)
	if err != nil {
		return nil, err
	}
	bindingKeys, err := loadBindingKeys(bindingKeysPath)
	if err != nil {
		return nil, err
	}
	identities, err := loadIdentities(identitiesPath)
	if err != nil {
		return nil, err
	}
	return NewVerifier(publicKeys, bindingKeys, identities)
}

func loadPublicKeys(path string) (map[string]ed25519.PublicKey, error) {
	var document jwksDocument
	if err := readJSONFile(path, &document); err != nil {
		return nil, errors.New("load rag workload JWKS")
	}
	keys := make(map[string]ed25519.PublicKey, len(document.Keys))
	for _, item := range document.Keys {
		if item.KTY != "OKP" || item.CRV != "Ed25519" || item.Alg != "EdDSA" || item.Use != "sig" ||
			!ragembedding.IsOpaqueID(item.KID) {
			return nil, errors.New("rag workload JWKS contains an invalid key")
		}
		decoded, err := base64.RawURLEncoding.DecodeString(item.X)
		if err != nil || len(decoded) != ed25519.PublicKeySize {
			return nil, errors.New("rag workload JWKS contains invalid Ed25519 material")
		}
		if _, duplicate := keys[item.KID]; duplicate {
			return nil, errors.New("rag workload JWKS contains a duplicate kid")
		}
		keys[item.KID] = ed25519.PublicKey(append([]byte(nil), decoded...))
	}
	return keys, nil
}

func loadBindingKeys(path string) (map[string][]byte, error) {
	var document bindingKeysDocument
	if err := readJSONFile(path, &document); err != nil {
		return nil, errors.New("load rag workload binding keys")
	}
	keys := make(map[string][]byte, len(document.Keys))
	for _, item := range document.Keys {
		if !ragembedding.IsOpaqueID(item.KID) {
			return nil, errors.New("rag workload binding keys contain an invalid kid")
		}
		decoded, err := base64.RawURLEncoding.DecodeString(item.Key)
		if err != nil || len(decoded) != 32 {
			return nil, errors.New("rag workload binding keys contain invalid material")
		}
		if _, duplicate := keys[item.KID]; duplicate {
			return nil, errors.New("rag workload binding keys contain a duplicate kid")
		}
		keys[item.KID] = append([]byte(nil), decoded...)
	}
	return keys, nil
}

func loadIdentities(path string) (map[string]IdentityConfig, error) {
	var document identitiesDocument
	if err := readJSONFile(path, &document); err != nil {
		return nil, errors.New("load rag workload identities")
	}
	identities := make(map[string]IdentityConfig, len(document.Identities))
	for _, item := range document.Identities {
		if !ragembedding.IsOpaqueID(item.KID) {
			return nil, errors.New("rag workload identities contain an invalid kid")
		}
		if _, duplicate := identities[item.KID]; duplicate {
			return nil, errors.New("rag workload identities contain a duplicate kid")
		}
		identities[item.KID] = IdentityConfig{
			Issuer:          item.Issuer,
			Subject:         item.Subject,
			AllowedPurposes: append([]ragembedding.Purpose(nil), item.AllowedPurposes...),
		}
	}
	return identities, nil
}

func readJSONFile(path string, target any) error {
	if strings.TrimSpace(path) == "" {
		return errors.New("configuration path is required")
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	if info.Size() > maximumConfigBytes {
		return errors.New("configuration exceeds maximum size")
	}

	decoder := json.NewDecoder(io.LimitReader(file, maximumConfigBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return errors.New("configuration contains multiple JSON values")
		}
		return err
	}
	return nil
}
