# External downloader output contracts

These fixtures pin the console-output contracts for the downloader versions in
[`scripts/deps-versions.json`](../../../../../../scripts/deps-versions.json):

- BBDown `1.6.3`
- yt-dlp `2026.07.04`

Each JSON array element represents exactly one chunk delivered to a Runner
callback. Contract tests trim and parse each element independently; they do not
join, split, or otherwise rechunk the captured output.

MediaGo's production runtime injects `PTYRunner`. On Unix/macOS, a successful
`pty.Start` keeps BBDown's terminal output enabled, and `readPTYOutput` forwards
its raw bytes as callback chunks. Only PTY startup failure uses the `StdoutPipe`
fallback, where this terminal progress is not guaranteed.

The fixture text uses synthetic identifiers while preserving the output shapes
defined by the pinned upstream sources:

| Fixture                | Official tagged source                                                                                                                                                                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bbdown-progress.json` | BBDown 1.6.3 [`ProgressBar.cs`](https://github.com/nilaoda/BBDown/blob/1.6.3/BBDown/ProgressBar.cs), [`Program.cs`](https://github.com/nilaoda/BBDown/blob/1.6.3/BBDown/Program.cs), and [`BBDownUtil.cs`](https://github.com/nilaoda/BBDown/blob/1.6.3/BBDown/BBDownUtil.cs) |
| `bbdown-failure.json`  | BBDown 1.6.3 [`Program.cs`](https://github.com/nilaoda/BBDown/blob/1.6.3/BBDown/Program.cs) and [`Logger.cs`](https://github.com/nilaoda/BBDown/blob/1.6.3/BBDown.Core/Logger.cs)                                                                                             |
| `yt-dlp-progress.json` | yt-dlp 2026.07.04 [`downloader/common.py`](https://github.com/yt-dlp/yt-dlp/blob/2026.07.04/yt_dlp/downloader/common.py) and [`YoutubeDL.py`](https://github.com/yt-dlp/yt-dlp/blob/2026.07.04/yt_dlp/YoutubeDL.py)                                                           |
| `yt-dlp-error.json`    | yt-dlp 2026.07.04 [`YoutubeDL.py`](https://github.com/yt-dlp/yt-dlp/blob/2026.07.04/yt_dlp/YoutubeDL.py)                                                                                                                                                                      |
