package discovery

import (
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestStoreEnforcesTransitionsAndSeparatesPrivateHeaders(t *testing.T) {
	now := time.Date(2026, 8, 26, 12, 0, 0, 0, time.UTC)
	store := NewStore(StoreOptions{
		Capacity:  20,
		Retention: 10 * time.Minute,
		Now:       func() time.Time { return now },
		NewID:     func() string { return "job-1" },
	})

	created, err := store.Create(normalizedInput("https://example.com/watch"), ExecutionBrowser)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if created.Status != StatusPending || created.ID != "job-1" {
		t.Fatalf("unexpected created job: %+v", created)
	}

	claimed, ok := store.ClaimNext()
	if !ok || claimed.ID != created.ID {
		t.Fatalf("ClaimNext() = %+v, %v", claimed, ok)
	}
	now = now.Add(time.Second)
	if _, err := store.Start(created.ID); err != nil {
		t.Fatalf("Start() error = %v", err)
	}

	privateSource := PrivateSource{
		DiscoverySource: DiscoverySource{
			ID:         "source-1",
			URL:        "https://cdn.example.com/master.m3u8",
			PageURL:    "https://example.com/watch",
			Title:      "Example",
			Type:       SourceTypeM3U8,
			DetectedAt: now,
		},
		Headers: []string{"Cookie: sentinel-cookie", "Referer: https://example.com/watch"},
	}
	now = now.Add(time.Second)
	completed, err := store.Complete(created.ID, []PrivateSource{privateSource}, false)
	if err != nil {
		t.Fatalf("Complete() error = %v", err)
	}
	if completed.Status != StatusCompleted || len(completed.Sources) != 1 {
		t.Fatalf("unexpected completed job: %+v", completed)
	}
	if got := completed.ExpiresAt.Sub(now); got != 10*time.Minute {
		t.Fatalf("retention = %s, want 10m", got)
	}

	headers, ok := store.PrivateHeaders(created.ID, "source-1")
	if !ok || len(headers) != 2 {
		t.Fatalf("PrivateHeaders() = %v, %v", headers, ok)
	}
	headers[0] = "changed"
	again, _ := store.PrivateHeaders(created.ID, "source-1")
	if again[0] != "Cookie: sentinel-cookie" {
		t.Fatal("PrivateHeaders returned mutable store data")
	}
	snapshot, snapshotHeaders, err := store.downloadSnapshot(created.ID)
	if err != nil || snapshot.ID != created.ID || len(snapshotHeaders["source-1"]) != 2 {
		t.Fatalf("download snapshot = %+v, %v, %v", snapshot, snapshotHeaders, err)
	}
	snapshotHeaders["source-1"][0] = "changed"
	_, nextHeaders, _ := store.downloadSnapshot(created.ID)
	if nextHeaders["source-1"][0] != "Cookie: sentinel-cookie" {
		t.Fatal("download snapshot shared private memory")
	}

	public, ok := store.Get(created.ID)
	if !ok || len(public.Sources) != 1 {
		t.Fatalf("Get() = %+v, %v", public, ok)
	}
	if _, err := store.Start(created.ID); !errors.Is(err, ErrInvalidTransition) {
		t.Fatalf("Start(completed) error = %v", err)
	}
	encoded, err := json.Marshal(public)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "sentinel-cookie") || strings.Contains(string(encoded), "headers") {
		t.Fatalf("public job leaked private headers: %s", encoded)
	}
	encodedPrivate, err := json.Marshal(privateSource)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encodedPrivate), "sentinel-cookie") || strings.Contains(string(encodedPrivate), "Headers") {
		t.Fatalf("private source is unsafe to serialize: %s", encodedPrivate)
	}
}

func TestStoreCapacityCancellationAndExpiry(t *testing.T) {
	now := time.Date(2026, 8, 26, 12, 0, 0, 0, time.UTC)
	ids := []string{"job-1", "job-2", "job-3"}
	store := NewStore(StoreOptions{
		Capacity:  2,
		Retention: time.Minute,
		Now:       func() time.Time { return now },
		NewID: func() string {
			id := ids[0]
			ids = ids[1:]
			return id
		},
	})

	first, _ := store.Create(normalizedInput("https://example.com/1"), ExecutionBrowser)
	second, _ := store.Create(normalizedInput("https://example.com/2"), ExecutionBrowser)
	if _, err := store.Create(normalizedInput("https://example.com/3"), ExecutionBrowser); !errors.Is(err, ErrQueueFull) {
		t.Fatalf("Create() error = %v, want queue full", err)
	}

	claimed, ok := store.ClaimNext()
	if !ok || claimed.ID != first.ID {
		t.Fatalf("first claim = %+v, %v", claimed, ok)
	}
	if _, err := store.Cancel(first.ID); err != nil {
		t.Fatalf("Cancel(active) error = %v", err)
	}
	claimed, ok = store.ClaimNext()
	if !ok || claimed.ID != second.ID {
		t.Fatalf("second claim = %+v, %v", claimed, ok)
	}
	if _, err := store.Cancel(second.ID); err != nil {
		t.Fatalf("Cancel(second) error = %v", err)
	}

	now = now.Add(time.Minute + time.Second)
	if removed := store.CleanupExpired(); removed != 2 {
		t.Fatalf("CleanupExpired() = %d, want 2", removed)
	}
	if _, ok := store.Get(first.ID); ok {
		t.Fatal("expired job remains in store")
	}
}

func TestStoreConcurrentReadsReturnIndependentCopies(t *testing.T) {
	store := NewStore(StoreOptions{Capacity: 20})
	job, err := store.Create(normalizedInput("https://example.com/watch"), ExecutionBrowser)
	if err != nil {
		t.Fatal(err)
	}

	var wg sync.WaitGroup
	for range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			got, ok := store.Get(job.ID)
			if !ok {
				t.Errorf("Get(%q) missing", job.ID)
				return
			}
			got.Input.URL = "https://attacker.invalid"
		}()
	}
	wg.Wait()

	got, _ := store.Get(job.ID)
	if got.Input.URL != "https://example.com/watch" {
		t.Fatalf("stored URL was mutated: %q", got.Input.URL)
	}
}

func TestStoreTerminalStatesRejectLateCallbacks(t *testing.T) {
	tests := []struct {
		name     string
		terminal func(*Store, string) error
	}{
		{
			name: "completed",
			terminal: func(store *Store, id string) error {
				_, err := store.Complete(id, nil, false)
				return err
			},
		},
		{
			name: "failed",
			terminal: func(store *Store, id string) error {
				_, err := store.Fail(id, "discovery_timeout", "timed out", nil, false)
				return err
			},
		},
		{
			name: "cancelled",
			terminal: func(store *Store, id string) error {
				_, err := store.Cancel(id)
				return err
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := NewStore(StoreOptions{Capacity: 20, NewID: func() string { return test.name }})
			job, err := store.Create(normalizedInput("https://example.com/watch"), ExecutionInspect)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := store.Start(job.ID); err != nil {
				t.Fatal(err)
			}
			if err := test.terminal(store, job.ID); err != nil {
				t.Fatal(err)
			}

			lateCallbacks := []func() error{
				func() error { _, err := store.Start(job.ID); return err },
				func() error { _, err := store.Complete(job.ID, nil, false); return err },
				func() error { _, err := store.Fail(job.ID, "late", "late", nil, false); return err },
				func() error { _, err := store.Cancel(job.ID); return err },
			}
			for _, callback := range lateCallbacks {
				if err := callback(); !errors.Is(err, ErrInvalidTransition) {
					t.Fatalf("late callback error = %v", err)
				}
			}
		})
	}
}

func normalizedInput(rawURL string) CreateDiscoveryInput {
	return CreateDiscoveryInput{
		URL:               rawURL,
		Mode:              ModeBrowser,
		TimeoutMS:         20_000,
		UseSessionCookies: false,
	}
}
