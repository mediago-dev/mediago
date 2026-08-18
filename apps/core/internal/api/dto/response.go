package dto

// SuccessResponse represents a standardized success response.
type SuccessResponse struct {
	Success bool        `json:"success" example:"true"`
	Code    int         `json:"code" example:"200"`
	Message string      `json:"message" example:"OK"`
	Data    interface{} `json:"data"`
}

// ErrorResponse represents a standardized error response.
type ErrorResponse struct {
	Success   bool   `json:"success" example:"false"`
	Code      int    `json:"code"`
	Message   string `json:"message"`
	ErrorCode string `json:"errorCode,omitempty"`
}

// HealthResponse represents the payload for health check.
type HealthResponse struct {
	Status string `json:"status" example:"ok"`
}
