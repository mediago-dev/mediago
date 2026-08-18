package core

import (
	"errors"
	"os"
	"testing"
)

func TestDependencyErrorFormatsAndUnwraps(t *testing.T) {
	cause := &os.PathError{Op: "stat", Path: "/tmp/BBDown", Err: os.ErrNotExist}
	err := &DependencyError{
		Tool:         "BBDown",
		ExpectedPath: "/tmp/BBDown",
		Err:          cause,
	}

	want := "required dependency BBDown is missing at /tmp/BBDown: " + cause.Error()
	if got := err.Error(); got != want {
		t.Fatalf("Error() = %q, want %q", got, want)
	}
	if !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("errors.Is(%v, os.ErrNotExist) = false, want true", err)
	}
}

func TestDependencyErrorAllowsNilCause(t *testing.T) {
	err := &DependencyError{Tool: "BBDown", ExpectedPath: "/tmp/BBDown"}

	if got, want := err.Error(), "required dependency BBDown is missing at /tmp/BBDown: <nil>"; got != want {
		t.Fatalf("Error() = %q, want %q", got, want)
	}
	if err.Unwrap() != nil {
		t.Fatalf("Unwrap() = %v, want nil", err.Unwrap())
	}
}
