<div align="center">
  <h1>MediaGo</h1>
  <a href="https://downloader.caorushizi.cn/it/guides.html?form=github">Avvio rapido</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://downloader.caorushizi.cn/it?form=github">Sito web</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://downloader.caorushizi.cn/it/documents.html?form=github">Documentazione</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://github.com/caorushizi/mediago/discussions">Discussioni</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://discord.gg/yxWBVRWGqM">Discord</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://www.reddit.com/r/MediaGo_Studio/">Reddit</a>
  <br>

<a href="https://github.com/caorushizi/mediago/blob/master/README.md">English</a>
<span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
<a href="https://github.com/caorushizi/mediago/blob/master/README.zh.md">中文</a>
<span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
<a href="https://github.com/caorushizi/mediago/blob/master/README.jp.md">日本語</a>
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

Un downloader video multipiattaforma con sniffing integrato: apri una
pagina, scegli la risorsa che ti interessa e salvala. Nessuna cattura dei
pacchetti, nessuna configurazione complicata di estensioni browser, nessuno
strumento da riga di comando da gestire.

L'interfaccia dell'app include attualmente inglese, cinese semplificato e
italiano.

## ✨ Cosa include

### 🌐 Estensione browser per Chrome / Edge

Trovi un video interessante su un sito qualsiasi → clicchi l'estensione →
lo invii a MediaGo con un clic. Rileva automaticamente le risorse video,
mostra il numero di elementi trovati nel badge della toolbar e funziona con
le principali piattaforme video, incluse YouTube, Bilibili e molte altre.
L'estensione è inclusa nell'app desktop: apri **Impostazioni → Altre
impostazioni → Directory estensione browser** per trovare la cartella di
installazione.

### 🎬 YouTube e oltre 1000 siti

Basato su yt-dlp. Supporta YouTube, Twitter/X, Instagram, Reddit e
[oltre mille altri siti video](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md).

### 🦞 Gli assistenti AI possono scaricare per te — OpenClaw Skill

Usi Claude Code, Cursor o un altro assistente AI per programmare? Installa
la skill MediaGo e scrivi semplicemente _"please download this video:
&lt;url&gt;"_. L'assistente gestisce il resto.

```shell
npx clawhub@latest install mediago
```

### 🔌 Funziona con altri strumenti

MediaGo espone una API HTTP completa: script, automazioni e app di terze
parti possono creare attività di download, consultare l'avanzamento e
gestire la lista. L'estensione browser usa la stessa API per parlare con
l'app desktop, e puoi integrarla anche nei tuoi workflow.

### 🎞️ Conversione formato integrata

Dopo il download puoi convertire il file in un altro formato o qualità
direttamente da MediaGo. Non serve aprire uno strumento ffmpeg separato.

### 🐳 Deploy Docker con un solo comando

Installazione headless sul tuo server, poi accesso alla UI web da qualsiasi
dispositivo nella stessa rete:

```shell
docker run -d --name mediago -p 8899:8899 -v /path/to/mediago:/app/mediago caorushizi/mediago:3.5.0
```

Disponibile su [Docker Hub](https://hub.docker.com/r/caorushizi/mediago)
e GHCR (`ghcr.io/caorushizi/mediago`): la stessa immagine, scegli il
registry più veloce per te. Supporta Intel / AMD (amd64) e ARM (arm64).
Nella build desktop, MediaGo ascolta sia su `127.0.0.1` sia sull'IP LAN,
così telefoni e tablet sulla stessa rete Wi-Fi possono aprire direttamente
la UI web.

## 📷 Screenshot

![Home](./images/home_en.png)

![Home — modalità scura](./images/home-dark_en.png)

![Impostazioni](./images/settings_en.png)

![Estrazione risorse](./images/browser_en.png)

## 📥 Download

### v3.5.0 (stabile)

- [Windows — installer](https://github.com/caorushizi/mediago/releases/download/v3.5.0/mediago-community-setup-win32-x64-3.5.0.exe)
- [Windows — portable](https://github.com/caorushizi/mediago/releases/download/v3.5.0/mediago-community-portable-win32-x64-3.5.0.exe)
- [macOS — Apple Silicon (arm64)](https://github.com/caorushizi/mediago/releases/download/v3.5.0/mediago-community-setup-darwin-arm64-3.5.0.dmg)
- [macOS — Intel (x64)](https://github.com/caorushizi/mediago/releases/download/v3.5.0/mediago-community-setup-darwin-x64-3.5.0.dmg)
- [Linux (deb)](https://github.com/caorushizi/mediago/releases/download/v3.5.0/mediago-community-setup-linux-amd64-3.5.0.deb)
- [**Docker Hub**](https://hub.docker.com/r/caorushizi/mediago): `docker run -d --name mediago -p 8899:8899 -v /path/to/mediago:/app/mediago caorushizi/mediago:3.5.0`
- **GHCR**: `docker run -d --name mediago -p 8899:8899 -v /path/to/mediago:/app/mediago ghcr.io/caorushizi/mediago:3.5.0`

Per le versioni precedenti, consulta la [pagina GitHub Releases](https://github.com/caorushizi/mediago/releases).

### 🪄 Deploy Docker con un clic tramite BT Panel

1. Installa [BT Panel](https://www.bt.cn/new/download.html?r=dk_mediago)
   usando lo script ufficiale.
2. Accedi al pannello, clicca **Docker** nella barra laterale e completa la
   configurazione del servizio Docker seguendo le istruzioni.
3. Trova **MediaGo** nello store delle app, clicca **Install**, configura il
   dominio e hai finito.

## 📝 Novità in v3.5.0

- **🌐 Estensione browser** — sniffing video su qualsiasi sito e invio a
  MediaGo con un clic
- **🎬 YouTube + 1000+ siti** — integrazione con yt-dlp
- **🦞 OpenClaw Skill** — scarica video tramite assistenti AI per programmare
- **🔌 API HTTP** — integrazione con script, automazioni e strumenti di terze parti
- **🎞️ Conversione formato in app** — scegli formato e qualità di output
- **🐳 Deploy Docker più semplice** — monta una sola cartella, immagini multi-arch su GHCR
- **⚡ Avvio più rapido** — backend riscritto, minore consumo di memoria, player video integrato

## 🧑‍💻 Sviluppo dal sorgente

I workflow del repository usano la versione fissa v3.51.1 di
[Task](https://taskfile.dev/). Su macOS, Linux o Windows (PowerShell),
installala con la toolchain Go, assicurati che la directory dei binari Go sia
nel `PATH` e verifica la versione prima di eseguire i comandi del repository:

```shell
go install github.com/go-task/task/v3/cmd/task@v3.51.1
task --version
```

Dopo il clone, esegui il flusso principale dalla radice del repository:

```shell
git clone https://github.com/caorushizi/mediago.git
cd mediago
task setup
task dev:all
```

`task setup` installa sia il workspace Node sia gli strumenti runtime richiesti
dall'app. L'unica fonte delle loro versioni è `scripts/deps-versions.json` e
non si aggiornano automaticamente. Eseguire solo `pnpm install` installa i
pacchetti del workspace Node, ma non i binari runtime come BBDown.

Usa `task dev:web` per la superficie web (`dev:server` è un alias di
`dev:web`) oppure `task dev:electron` per lo sviluppo desktop. Prima di
inviare modifiche, esegui:

```shell
task check
task test
```

## 🛠️ Tecnologie

[![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)](https://react.dev/)
[![Electron](https://img.shields.io/badge/Electron-191970?logo=electron&logoColor=white)](https://www.electronjs.org)
[![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)](https://vitejs.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![shadcn/ui](https://img.shields.io/badge/shadcn%2Fui-000?logo=shadcnui&logoColor=white)](https://ui.shadcn.com/)
[![Go](https://img.shields.io/badge/Go-00ADD8?logo=go&logoColor=white)](https://go.dev/)

## 🙏 Ringraziamenti

- [N_m3u8DL-RE](https://github.com/nilaoda/N_m3u8DL-RE)
- [BBDown](https://github.com/nilaoda/BBDown)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [aria2](https://aria2.github.io/)
- [mediago-core](https://github.com/caorushizi/mediago-core)

## ⚖️ Disclaimer

> **Questo progetto è destinato esclusivamente a scopi educativi e di ricerca. Non usarlo per finalità commerciali o illegali.**
>
> 1. Tutto il codice e tutte le funzionalità fornite da questo progetto sono pensati solo come riferimento per lo studio delle tecnologie di streaming. Gli utenti devono rispettare le leggi e i regolamenti della propria giurisdizione.
> 2. Qualsiasi contenuto scaricato tramite questo progetto resta di proprietà dei rispettivi titolari dei diritti. Gli utenti devono eliminare i contenuti scaricati entro 24 ore o ottenere un'autorizzazione adeguata.
> 3. Gli sviluppatori del progetto non sono responsabili delle azioni degli utenti, incluso il download di contenuti protetti da copyright o l'impatto su piattaforme di terze parti.
> 4. È vietato usare questo progetto per scraping massivo, interruzione dei servizi delle piattaforme o qualsiasi attività che violi diritti legittimi altrui.
> 5. Usando questo progetto confermi di aver letto e accettato questo disclaimer. Se non lo accetti, interrompi subito l'uso del progetto ed eliminalo.

---

> Vuoi compilare da sorgente? Consulta [CONTRIBUTING.md](./CONTRIBUTING.md).
>
> Vuoi tradurre MediaGo? Consulta [TRANSLATION.md](./TRANSLATION.md).
