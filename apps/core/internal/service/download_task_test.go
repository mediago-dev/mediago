package service

import (
	"errors"
	"path/filepath"
	"reflect"
	"slices"
	"testing"

	"caorushizi.cn/mediago/internal/core"
	"caorushizi.cn/mediago/internal/db"
	"caorushizi.cn/mediago/internal/db/repo"
)

func TestAddDownloadTaskRejectsExistingURL(t *testing.T) {
	service, videoRepo := newTestDownloadTaskService(t)
	input := &AddDownloadTaskInput{
		Name: "first",
		Type: "m3u8",
		URL:  "https://example.com/video.m3u8",
	}

	if _, err := service.AddDownloadTask(input); err != nil {
		t.Fatalf("first AddDownloadTask() error = %v", err)
	}
	input.Name = "second"
	if _, err := service.AddDownloadTask(input); !errors.Is(err, ErrDownloadURLAlreadyExists) {
		t.Fatalf("duplicate AddDownloadTask() error = %v, want %v", err, ErrDownloadURLAlreadyExists)
	}

	videos, err := videoRepo.FindAll("ASC")
	if err != nil {
		t.Fatalf("FindAll() error = %v", err)
	}
	if len(videos) != 1 {
		t.Fatalf("stored video count = %d, want 1", len(videos))
	}
}

func TestAddDownloadTasksRejectsDuplicateURLWithinBatch(t *testing.T) {
	service, videoRepo := newTestDownloadTaskService(t)
	inputs := []*AddDownloadTaskInput{
		{Name: "first", Type: "m3u8", URL: "https://example.com/video.m3u8"},
		{Name: "second", Type: "m3u8", URL: "https://example.com/video.m3u8"},
	}

	if _, err := service.AddDownloadTasks(inputs); !errors.Is(err, ErrDownloadURLAlreadyExists) {
		t.Fatalf("AddDownloadTasks() error = %v, want %v", err, ErrDownloadURLAlreadyExists)
	}
	videos, err := videoRepo.FindAll("ASC")
	if err != nil {
		t.Fatalf("FindAll() error = %v", err)
	}
	if len(videos) != 0 {
		t.Fatalf("stored video count = %d, want 0", len(videos))
	}
}

func TestAddDownloadTaskSerializesConcurrentDuplicateURL(t *testing.T) {
	service, videoRepo := newTestDownloadTaskService(t)
	start := make(chan struct{})
	errorsCh := make(chan error, 2)

	for _, name := range []string{"first", "second"} {
		go func() {
			<-start
			_, err := service.AddDownloadTask(&AddDownloadTaskInput{
				Name: name,
				Type: "m3u8",
				URL:  "https://example.com/video.m3u8",
			})
			errorsCh <- err
		}()
	}
	close(start)

	var successCount, duplicateCount int
	for range 2 {
		err := <-errorsCh
		switch {
		case err == nil:
			successCount++
		case errors.Is(err, ErrDownloadURLAlreadyExists):
			duplicateCount++
		default:
			t.Fatalf("AddDownloadTask() error = %v", err)
		}
	}
	if successCount != 1 || duplicateCount != 1 {
		t.Fatalf("successes = %d, duplicates = %d, want 1 each", successCount, duplicateCount)
	}

	videos, err := videoRepo.FindAll("ASC")
	if err != nil {
		t.Fatalf("FindAll() error = %v", err)
	}
	if len(videos) != 1 {
		t.Fatalf("stored video count = %d, want 1", len(videos))
	}
}

func TestEditDownloadTaskRejectsAnotherTasksURL(t *testing.T) {
	service, _ := newTestDownloadTaskService(t)
	first, err := service.AddDownloadTask(&AddDownloadTaskInput{
		Name: "first",
		Type: "m3u8",
		URL:  "https://example.com/first.m3u8",
	})
	if err != nil {
		t.Fatalf("first AddDownloadTask() error = %v", err)
	}
	second, err := service.AddDownloadTask(&AddDownloadTaskInput{
		Name: "second",
		Type: "m3u8",
		URL:  "https://example.com/second.m3u8",
	})
	if err != nil {
		t.Fatalf("second AddDownloadTask() error = %v", err)
	}

	_, err = service.EditDownloadTask(second.ID, map[string]interface{}{"url": first.URL})
	if !errors.Is(err, ErrDownloadURLAlreadyExists) {
		t.Fatalf("EditDownloadTask() error = %v, want %v", err, ErrDownloadURLAlreadyExists)
	}
	stored, err := service.FindByIDOrFail(second.ID)
	if err != nil {
		t.Fatalf("FindByIDOrFail() error = %v", err)
	}
	if stored.URL != second.URL {
		t.Fatalf("stored URL = %s, want %s", stored.URL, second.URL)
	}
}

func TestParseStoredHeadersMultiline(t *testing.T) {
	raw := "Referer:https://example.com/watch/video\r\nOrigin:https://example.com\r\nUser-Agent:Mozilla/5.0\r\n\r\n"
	want := []string{
		"Referer:https://example.com/watch/video",
		"Origin:https://example.com",
		"User-Agent:Mozilla/5.0",
	}

	if got := parseStoredHeaders(raw); !slices.Equal(got, want) {
		t.Fatalf("parseStoredHeaders() = %v, want %v", got, want)
	}
}

func TestParseStoredHeadersJSON(t *testing.T) {
	raw := `["Referer:https://www.bilibili.com","Cookie:SESSDATA=secret"]`
	want := []string{
		"Referer:https://www.bilibili.com",
		"Cookie:SESSDATA=secret",
	}

	if got := parseStoredHeaders(raw); !slices.Equal(got, want) {
		t.Fatalf("parseStoredHeaders() = %v, want %v", got, want)
	}
}

func TestParseStoredHeadersEmpty(t *testing.T) {
	if got := parseStoredHeaders("\r\n \n"); len(got) != 0 {
		t.Fatalf("parseStoredHeaders() = %v, want empty", got)
	}
}

func TestDownloadParamsForVideoPreservesBilibiliFields(t *testing.T) {
	folder := "哔哩哔哩"
	headers := "Cookie:SESSDATA=test-cookie\r\nReferer:https://www.bilibili.com/video/BV1xx411c7mD"
	video := &db.Video{
		Name:    "测试视频",
		Type:    "bilibili",
		URL:     "https://www.bilibili.com/video/BV1xx411c7mD",
		Folder:  &folder,
		Headers: &headers,
	}

	got := downloadParamsForVideo(video, int64(42))
	want := core.DownloadParams{
		ID:     core.TaskID("42"),
		Type:   core.TypeBilibili,
		URL:    video.URL,
		Name:   video.Name,
		Folder: folder,
		Headers: []string{
			"Cookie:SESSDATA=test-cookie",
			"Referer:https://www.bilibili.com/video/BV1xx411c7mD",
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("downloadParamsForVideo() = %#v, want %#v", got, want)
	}
}

func newTestDownloadTaskService(t *testing.T) (*DownloadTaskService, *repo.VideoRepository) {
	t.Helper()
	database, err := db.New(filepath.Join(t.TempDir(), "mediago.db"))
	if err != nil {
		t.Fatalf("db.New() error = %v", err)
	}
	t.Cleanup(func() {
		if err := database.Close(); err != nil {
			t.Errorf("database.Close() error = %v", err)
		}
	})

	videoRepo := repo.NewVideoRepository(database)
	return NewDownloadTaskService(videoRepo, nil, nil), videoRepo
}
