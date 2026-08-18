package docs

import (
	"encoding/json"
	"slices"
	"testing"
)

func TestErrorResponseSchemaIncludesOptionalMachineCode(t *testing.T) {
	var document struct {
		Definitions map[string]struct {
			Required   []string `json:"required"`
			Properties map[string]struct {
				Type string `json:"type"`
			} `json:"properties"`
		} `json:"definitions"`
	}
	if err := json.Unmarshal([]byte(SwaggerInfo.ReadDoc()), &document); err != nil {
		t.Fatalf("decode generated Swagger document: %v", err)
	}

	const definitionName = "caorushizi_cn_mediago_internal_api_dto.ErrorResponse"
	schema, ok := document.Definitions[definitionName]
	if !ok {
		t.Fatalf("Swagger definitions missing %q", definitionName)
	}

	wantTypes := map[string]string{
		"success":   "boolean",
		"code":      "integer",
		"message":   "string",
		"errorCode": "string",
	}
	for property, wantType := range wantTypes {
		got, ok := schema.Properties[property]
		if !ok {
			t.Errorf("ErrorResponse properties missing %q", property)
			continue
		}
		if got.Type != wantType {
			t.Errorf("ErrorResponse.%s type = %q, want %q", property, got.Type, wantType)
		}
	}
	if slices.Contains(schema.Required, "errorCode") {
		t.Fatal("ErrorResponse.errorCode must remain optional")
	}
}
