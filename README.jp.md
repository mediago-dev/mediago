<div align="center">
  <h1>MediaGo</h1>
  <a href="https://downloader.caorushizi.cn/jp/guides.html?form=github">クイックスタート</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://downloader.caorushizi.cn/jp?form=github">公式サイト</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://downloader.caorushizi.cn/jp/documents.html?form=github">ドキュメント</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://github.com/caorushizi/mediago/discussions">Discussions</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://discord.gg/yxWBVRWGqM">Discord</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://www.reddit.com/r/MediaGo_Studio/">Reddit</a>
  <br>

<a href="https://github.com/caorushizi/mediago/blob/master/README.md">English</a>
<span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
<a href="https://github.com/caorushizi/mediago/blob/master/README.zh.md">中文</a>
<span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
<a href="https://github.com/caorushizi/mediago/blob/master/README.it.md">Italiano</a>
<br>

  <img alt="GitHub Downloads (all assets, all releases)" src="https://img.shields.io/github/downloads/caorushizi/mediago/total">
  <img alt="GitHub Downloads (all assets, latest release)" src="https://img.shields.io/github/downloads/caorushizi/mediago/latest/total">
  <img alt="GitHub Repo stars" src="https://img.shields.io/github/stars/caorushizi/mediago">
  <img alt="GitHub forks" src="https://img.shields.io/github/forks/caorushizi/mediago">
  <img alt="GitCode" src="https://gitcode.com/caorushizi/mediago/star/badge.svg">
  <br>

  <a href="https://trendshift.io/repositories/11083" target="_blank">
    <img src="https://trendshift.io/api/badge/repositories/11083" alt="caorushizi%2Fmediago | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/>
  </a>

  <hr />
</div>

ビルトインのスニッフィング機能を備えたクロスプラットフォームの動画ダウンローダー —— ページを開いて、欲しいリソースを選んで、保存するだけ。パケットキャプチャ不要、ブラウザ拡張の設定不要、コマンドラインの操作も不要です。

アプリ UI は現在、英語・簡体中国語・イタリア語に対応しています。

## ✨ 主な機能

### 🌐 ブラウザ拡張機能（Chrome / Edge）

ウェブを閲覧中に気になる動画を見つけたら → 拡張機能のアイコンをクリック → ワンクリックで MediaGo に送信。ページ内のダウンロード可能なリソースを自動検出し、ツールバーアイコンのバッジに件数を表示します。YouTube、Bilibili をはじめ主要な動画サイトに対応。拡張機能はデスクトップ版インストーラーに同梱されているので、**設定 → その他の設定 → ブラウザ拡張ディレクトリ** から直接インストールフォルダを開けます。

### 🎬 YouTube と 1000+ サイト対応

内部では yt-dlp を使用。YouTube、Twitter/X、Instagram、Reddit など [1000 以上の動画サイト](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md) をサポートします。

### 🦞 AI アシスタントで動画をダウンロード — OpenClaw Skill

Claude Code や Cursor などの AI コーディングアシスタントを使っていますか？MediaGo Skill をインストールすれば、AI に「この動画をダウンロードして：&lt;URL&gt;」と言うだけでダウンロードが始まります。

```shell
npx clawhub@latest install mediago
```

### 🔌 他のツールと連携

MediaGo は完全な HTTP API を提供します。スクリプト、自動化ツール、他のアプリから直接ダウンロードタスクの作成、進捗の取得、リスト管理が可能です。ブラウザ拡張機能はこの API を介してデスクトップアプリと通信しており、自分のワークフローに組み込むこともできます。

### 🎞️ 内蔵フォーマット変換

ダウンロード完了後、MediaGo 内で他のフォーマットや画質に変換できます。ffmpeg を別途起動する必要はありません。

### 🐳 Docker でワンライン展開

サーバーにヘッドレスでインストールし、同じネットワーク内のどこからでも Web UI にアクセスできます：

```shell
docker run -d --name mediago -p 8899:8899 -v /path/to/mediago:/app/mediago caorushizi/mediago:3.5.0
```

[Docker Hub](https://hub.docker.com/r/caorushizi/mediago) と GHCR（`ghcr.io/caorushizi/mediago`）の両方で配信しています。同じイメージなのでお好みのレジストリを。Intel / AMD (amd64) と ARM (arm64) の両方に対応。デスクトップ版は `127.0.0.1` と LAN IP の両方で待ち受けるため、同じ Wi-Fi のスマートフォンやタブレットからも Web UI を開けます。

## 📷 スクリーンショット

![ホームページ](./images/home.png)

![ホームページ — ダークモード](./images/home-dark.png)

![設定](./images/settings.png)

![リソース抽出](./images/browser.png)

## 📥 ダウンロード

### v3.5.0（安定版）

- [Windows — インストーラー版](https://github.com/caorushizi/mediago/releases/download/v3.5.0/mediago-community-setup-win32-x64-3.5.0.exe)
- [Windows — ポータブル版](https://github.com/caorushizi/mediago/releases/download/v3.5.0/mediago-community-portable-win32-x64-3.5.0.exe)
- [macOS — Apple Silicon (arm64)](https://github.com/caorushizi/mediago/releases/download/v3.5.0/mediago-community-setup-darwin-arm64-3.5.0.dmg)
- [macOS — Intel (x64)](https://github.com/caorushizi/mediago/releases/download/v3.5.0/mediago-community-setup-darwin-x64-3.5.0.dmg)
- [Linux (deb)](https://github.com/caorushizi/mediago/releases/download/v3.5.0/mediago-community-setup-linux-amd64-3.5.0.deb)
- [**Docker Hub**](https://hub.docker.com/r/caorushizi/mediago)：`docker run -d --name mediago -p 8899:8899 -v /path/to/mediago:/app/mediago caorushizi/mediago:3.5.0`
- **GHCR**：`docker run -d --name mediago -p 8899:8899 -v /path/to/mediago:/app/mediago ghcr.io/caorushizi/mediago:3.5.0`

過去のバージョンは [GitHub Releases ページ](https://github.com/caorushizi/mediago/releases) をご覧ください。

### 🪄 宝塔パネルでワンクリック Docker デプロイ

1. [宝塔パネル公式サイト](https://www.bt.cn/new/download.html?r=dk_mediago) から正式版のスクリプトをダウンロードしてインストール
2. 宝塔パネルにログイン、メニューから **Docker** をクリック。初回アクセス時に Docker サービスのインストールを求められるので、「今すぐインストール」をクリックして完了
3. アプリストアで **MediaGo** を見つけて、インストールをクリック、ドメインなどの基本情報を設定すれば完了

## 📝 v3.5.0 の新機能

- **🌐 ブラウザ拡張機能** — 任意のサイトで動画をスニッフィング、ワンクリックで MediaGo に送信
- **🎬 YouTube + 1000+ サイト** — yt-dlp による対応
- **🦞 OpenClaw Skill** — AI コーディングアシスタント経由でダウンロード
- **🔌 HTTP API** — スクリプト、自動化、サードパーティツールとの統合
- **🎞️ アプリ内フォーマット変換** — 出力形式と画質を選択
- **🐳 Docker デプロイの簡素化** — 単一ディレクトリをマウント、GHCR のマルチアーキテクチャイメージ
- **⚡ 起動の高速化** — バックエンド書き換え、メモリ使用量の削減、内蔵動画プレーヤー

## 🧑‍💻 ソースからの開発

リポジトリのタスク実行には固定版の [Task](https://taskfile.dev/) v3.51.1 を使用します。
macOS、Linux、Windows（PowerShell）では Go ツールチェーンで固定版をインストールできます。
Go のバイナリディレクトリを `PATH` に追加してから、バージョンを確認してください：

```shell
go install github.com/go-task/task/v3/cmd/task@v3.51.1
task --version
```

クローン後は、リポジトリのルートで次の標準フローを実行します：

```shell
git clone https://github.com/caorushizi/mediago.git
cd mediago
task setup
task dev:all
```

`task setup` は Node ワークスペース依存関係とアプリに必要なランタイムツールを
まとめてインストールします。ランタイム依存関係のバージョンは
`scripts/deps-versions.json` だけを参照し、自動更新されません。`pnpm install` だけでは
Node ワークスペース依存関係しか入らず、BBDown などのランタイムバイナリは入りません。

Web のみを開発する場合は `task dev:web`（`dev:server` は `dev:web` のエイリアス）、
デスクトップのみの場合は `task dev:electron` を使います。変更を送信する前に以下を実行します：

```shell
task check
task test
```

## 🛠️ 技術スタック

[![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)](https://react.dev/)
[![Electron](https://img.shields.io/badge/Electron-191970?logo=electron&logoColor=white)](https://www.electronjs.org)
[![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)](https://vitejs.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![shadcn/ui](https://img.shields.io/badge/shadcn%2Fui-000?logo=shadcnui&logoColor=white)](https://ui.shadcn.com/)
[![Go](https://img.shields.io/badge/Go-00ADD8?logo=go&logoColor=white)](https://go.dev/)

## 🙏 謝辞

- [N_m3u8DL-RE](https://github.com/nilaoda/N_m3u8DL-RE)
- [BBDown](https://github.com/nilaoda/BBDown)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [aria2](https://aria2.github.io/)
- [mediago-core](https://github.com/caorushizi/mediago-core)

## ⚖️ 免責事項

> **本プロジェクトは学習および研究目的にのみ提供されるものであり、商用または違法な目的での使用はご遠慮ください。**
>
> 1. 本プロジェクトが提供するすべてのコードおよび機能は、ストリーミング技術の学習のための参考資料としてのみ使用されます。利用者は所在地域の法令を遵守してください。
> 2. 本プロジェクトを使用してダウンロードされたコンテンツの著作権は、原コンテンツの所有者に帰属します。利用者はダウンロード後 24 時間以内にコンテンツを削除するか、著作権者の許可を取得する必要があります。
> 3. 本プロジェクトの開発者は、著作権で保護されたコンテンツのダウンロードや第三者プラットフォームへの影響を含め、利用者の行動に対して一切の責任を負いません。
> 4. 大規模なスクレイピング、プラットフォームサービスの妨害、その他他者の合法的権利を侵害する行為に本プロジェクトを使用することは禁止されています。
> 5. 本プロジェクトを使用することにより、あなたはこの免責事項を読み、同意したものとみなされます。同意しない場合は、直ちに本プロジェクトの使用を停止し、削除してください。

---

> ソースからビルドする場合は [CONTRIBUTING.md](./CONTRIBUTING.md)（英語）を参照してください。
>
> MediaGo の翻訳をご検討中の方は [TRANSLATION.md](./TRANSLATION.md)（英語）をご参照ください。
