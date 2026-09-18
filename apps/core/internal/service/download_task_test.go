package service

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"caorushizi.cn/mediago/internal/core"
	"caorushizi.cn/mediago/internal/db"
	"caorushizi.cn/mediago/internal/db/repo"
	"caorushizi.cn/mediago/internal/logger"
	"caorushizi.cn/mediago/internal/tasklog"
	"go.uber.org/zap"
)

type headerCaptureDownloader struct {
	params chan core.DownloadParams
}

func (d *headerCaptureDownloader) Download(_ context.Context, params core.DownloadParams, _ core.Callbacks) (core.DownloadResult, error) {
	d.params <- params
	return core.DownloadResult{PrimaryPath: "/downloads/runtime-credentials.mp4"}, nil
}

func (*headerCaptureDownloader) Config() interface{} { return nil }

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

func TestAddDownloadTaskInfersYTDLPForXStatusURL(t *testing.T) {
	service, _ := newTestDownloadTaskService(t)
	video, err := service.AddDownloadTask(&AddDownloadTaskInput{
		Name: "x-video",
		URL:  "https://x.com/mediago/status/1234567890?s=20",
	})
	if err != nil {
		t.Fatalf("AddDownloadTask() error = %v", err)
	}
	if video.Type != string(core.TypeYoutube) {
		t.Fatalf("stored type = %q, want %q", video.Type, core.TypeYoutube)
	}
}

func TestAddDownloadTasksInfersTypesIndependently(t *testing.T) {
	service, _ := newTestDownloadTaskService(t)
	videos, err := service.AddDownloadTasks([]*AddDownloadTaskInput{
		{Name: "stream", URL: "https://cdn.example.com/master.m3u8?token=secret"},
		{Name: "x-video", URL: "https://twitter.com/mediago/status/1234567890"},
	})
	if err != nil {
		t.Fatalf("AddDownloadTasks() error = %v", err)
	}
	want := []string{string(core.TypeM3U8), string(core.TypeYoutube)}
	for index, video := range videos {
		if video.Type != want[index] {
			t.Fatalf("videos[%d].Type = %q, want %q", index, video.Type, want[index])
		}
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

	if got := ParseStoredHeaders(raw); !slices.Equal(got, want) {
		t.Fatalf("ParseStoredHeaders() = %v, want %v", got, want)
	}
}

func TestParseStoredHeadersJSON(t *testing.T) {
	raw := `["Referer:https://www.bilibili.com","Cookie:SESSDATA=secret"]`
	want := []string{
		"Referer:https://www.bilibili.com",
		"Cookie:SESSDATA=secret",
	}

	if got := ParseStoredHeaders(raw); !slices.Equal(got, want) {
		t.Fatalf("ParseStoredHeaders() = %v, want %v", got, want)
	}
}

func TestParseStoredHeadersEmpty(t *testing.T) {
	if got := ParseStoredHeaders("\r\n \n"); len(got) != 0 {
		t.Fatalf("ParseStoredHeaders() = %v, want empty", got)
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

func TestStartDownloadWithRuntimeHeadersDoesNotPersistCredentials(t *testing.T) {
	previousLogger, previousSugar := logger.Logger, logger.Sugar
	logger.Logger = zap.NewNop()
	logger.Sugar = logger.Logger.Sugar()
	t.Cleanup(func() {
		logger.Logger = previousLogger
		logger.Sugar = previousSugar
	})

	database, err := db.New(filepath.Join(t.TempDir(), "mediago.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	repository := repo.NewVideoRepository(database)
	downloader := &headerCaptureDownloader{params: make(chan core.DownloadParams, 1)}
	queue := core.NewTaskQueue(downloader, 1)
	svc := NewDownloadTaskService(repository, queue, nil)

	runtimeHeaders := []string{
		"Cookie: sentinel-cookie",
		"Authorization: Bearer sentinel-authorization",
		"Proxy-Authorization: Basic sentinel-proxy",
		"Referer: https://example.com/watch",
		"User-Agent: MediaGo-Test",
	}
	persistedHeaders := PersistentDiscoveryHeaders(runtimeHeaders)
	video, err := svc.AddDownloadTask(&AddDownloadTaskInput{
		Name:    "runtime-credentials",
		Type:    "m3u8",
		URL:     "https://cdn.example.com/master.m3u8",
		Headers: persistedHeaders,
	})
	if err != nil {
		t.Fatal(err)
	}
	stored, err := repository.FindByIDOrFail(video.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Headers == nil || strings.Contains(*stored.Headers, "sentinel-") || !strings.Contains(*stored.Headers, "Referer") {
		t.Fatalf("persisted headers = %v", stored.Headers)
	}

	if err := svc.StartDownloadWithRuntimeHeaders(video.ID, video.URL, t.TempDir(), false, runtimeHeaders); err != nil {
		t.Fatal(err)
	}
	select {
	case params := <-downloader.params:
		joined := strings.Join(params.Headers, "\n")
		for _, expected := range []string{"sentinel-cookie", "sentinel-authorization", "sentinel-proxy", "Referer", "User-Agent"} {
			if !strings.Contains(joined, expected) {
				t.Fatalf("runtime params missing %q: %s", expected, joined)
			}
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for download params")
	}
	waitForRuntimeHeaderQueue(t, queue)
}

func TestGetDownloadTaskUsesPersistedOutputOutsideCurrentDirectory(t *testing.T) {
	svc, videoRepo := newTestDownloadTaskService(t)
	actualOutput := filepath.Join(t.TempDir(), "persisted-video.mp4")
	writeTestOutput(t, actualOutput, "media")
	video, err := videoRepo.Create(&db.Video{
		Name:       "display title does not match file",
		Type:       string(core.TypeYoutube),
		URL:        "https://example.com/persisted",
		Status:     "success",
		OutputPath: actualOutput,
	})
	if err != nil {
		t.Fatal(err)
	}

	result, err := svc.GetDownloadTask(video.ID, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if !result.Exists || result.File != actualOutput {
		t.Fatalf("GetDownloadTask() = exists %v, file %q", result.Exists, result.File)
	}
}

func TestDownloadFileLookupUsesTaskDirectory(t *testing.T) {
	svc, repository := newTestDownloadTaskService(t)
	customDir, folder := t.TempDir(), "courses"
	output := filepath.Join(customDir, folder, "video.mp4")
	if err := os.MkdirAll(filepath.Dir(output), 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestOutput(t, output, "media")
	video, err := repository.Create(&db.Video{Name: "video", Type: "direct", URL: "https://example.com/video.mp4", Status: "success", DownloadDir: customDir, Folder: &folder})
	if err != nil {
		t.Fatal(err)
	}
	result, err := svc.GetDownloadTask(video.ID, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if !result.Exists || result.File != output {
		t.Fatalf("unexpected file lookup: %+v", result)
	}
	listed, err := svc.GetDownloadTasks(1, 10, "done", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if len(listed.List) != 1 || listed.List[0].File != output {
		t.Fatalf("unexpected list: %+v", listed)
	}
}

func TestCompleteDownloadPersistsAndResolvesEveryArtifact(t *testing.T) {
	svc, videoRepo := newTestDownloadTaskService(t)
	outputDir := t.TempDir()
	primary := filepath.Join(outputDir, "part-1.mp4")
	secondary := filepath.Join(outputDir, "part-2.mp4")
	writeTestOutput(t, primary, "part one")
	writeTestOutput(t, secondary, "part two")

	video, err := videoRepo.Create(&db.Video{
		Name:   "multi-part download",
		Type:   string(core.TypeBilibili),
		URL:    "https://www.bilibili.com/video/BV-multi-part",
		Status: "downloading",
	})
	if err != nil {
		t.Fatal(err)
	}
	result := core.DownloadResult{
		PrimaryPath:   primary,
		ArtifactPaths: []string{primary, secondary},
	}
	if err := svc.CompleteDownload(video.ID, result); err != nil {
		t.Fatal(err)
	}

	storedPaths, err := videoRepo.FindArtifactPaths([]int64{video.ID})
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(storedPaths[video.ID], result.ArtifactPaths) {
		t.Fatalf("stored artifacts = %q, want %q", storedPaths[video.ID], result.ArtifactPaths)
	}
	download, err := svc.GetDownloadTask(video.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	if !download.Exists || download.File != primary || !slices.Equal(download.Files, result.ArtifactPaths) {
		t.Fatalf("resolved download = exists %v, file %q, files %q", download.Exists, download.File, download.Files)
	}

	if err := videoRepo.PrepareDownload(video.ID); err != nil {
		t.Fatal(err)
	}
	storedPaths, err = videoRepo.FindArtifactPaths([]int64{video.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(storedPaths[video.ID]) != 0 {
		t.Fatalf("artifacts after PrepareDownload = %q, want none", storedPaths[video.ID])
	}
}

func TestGetDownloadTaskBackfillsLegacyOutputFromLog(t *testing.T) {
	database, err := db.New(filepath.Join(t.TempDir(), "mediago.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	videoRepo := repo.NewVideoRepository(database)
	logs := tasklog.NewManager(filepath.Join(t.TempDir(), "logs"))
	svc := NewDownloadTaskService(videoRepo, nil, logs)

	name := "@creator · legacy.clip"
	actualOutput := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(actualOutput, []byte("legacy media"), 0o600); err != nil {
		t.Fatal(err)
	}
	video, err := videoRepo.Create(&db.Video{
		Name:   name,
		Type:   string(core.TypeYoutube),
		URL:    "https://example.com/legacy",
		Status: "success",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := logs.Append(string(queueTaskIDForDownload(video.ID)), "[download] Destination: "+actualOutput); err != nil {
		t.Fatal(err)
	}

	result, err := svc.GetDownloadTask(video.ID, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if !result.Exists || result.File != actualOutput {
		t.Fatalf("GetDownloadTask() = exists %v, file %q", result.Exists, result.File)
	}
	stored, err := videoRepo.FindByIDOrFail(video.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.OutputPath != actualOutput {
		t.Fatalf("backfilled outputPath = %q, want %q", stored.OutputPath, actualOutput)
	}
}

func waitForRuntimeHeaderQueue(t *testing.T, queue *core.TaskQueue) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for queue.IsFull() {
		if time.Now().After(deadline) {
			t.Fatal("timed out waiting for download queue")
		}
		time.Sleep(time.Millisecond)
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
