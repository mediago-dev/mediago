package core

import "fmt"

// DependencyError reports a configured runtime dependency that cannot be used.
type DependencyError struct {
	Tool         string
	ExpectedPath string
	Err          error
}

func (e *DependencyError) Error() string {
	return fmt.Sprintf("required dependency %s is missing at %s: %v", e.Tool, e.ExpectedPath, e.Err)
}

func (e *DependencyError) Unwrap() error {
	return e.Err
}
