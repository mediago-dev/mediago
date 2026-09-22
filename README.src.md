<!--@nrg.languages=en,it,jp,zh-->
<!--@nrg.defaultLanguage=en-->
<div align="center"><!--en-->
  <h1>MediaGo</h1><!--en-->
  <a href="https://downloader.caorushizi.cn/en/guides.html?form=github">Quick Start</a><!--en-->
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span><!--en-->
  <a href="https://downloader.caorushizi.cn/en?form=github">Website</a><!--en-->
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span><!--en-->
  <a href="https://downloader.caorushizi.cn/en/documents.html?form=github">Docs</a><!--en-->
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span><!--en-->
  <a href="https://github.com/caorushizi/mediago/discussions">Discussions</a><!--en-->
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span><!--en-->
  <a href="https://discord.gg/yxWBVRWGqM">Discord</a><!--en-->
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span><!--en-->
  <a href="https://www.reddit.com/r/MediaGo_Studio/">Reddit</a><!--en-->
  <br><!--en-->
<!--en-->
<a href="https://github.com/caorushizi/mediago/blob/master/README.zh.md">中文</a><!--en-->
<span>&nbsp;&nbsp;•&nbsp;&nbsp;</span><!--en-->
<a href="https://github.com/caorushizi/mediago/blob/master/README.jp.md">日本語</a><!--en-->
<span>&nbsp;&nbsp;•&nbsp;&nbsp;</span><!--en-->
<a href="https://github.com/caorushizi/mediago/blob/master/README.it.md">Italiano</a><!--en-->
<br><!--en-->
<!--en-->
  <!-- MediaGo Pro --><!--en-->
  <a href="https://mediago.torchstellar.com/?from=github"><!--en-->
    <img src="https://img.shields.io/badge/✨_New_Release-MediaGo_Pro-ff6b6b?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiPjxwYXRoIGQ9Ik0xMiAyTDMgN2wzIDMgNi00IDYgNCAzLTMtOS01eiIvPjxwYXRoIGQ9Ik0zIDE3bDkgNSA5LTUtMy0zLTYgNC02LTQtMyAzeiIvPjwvc3ZnPg==" alt="MediaGo Pro" /><!--en-->
  </a><!--en-->
  <a href="https://mediago.torchstellar.com/?from=github"><!--en-->
    <img src="https://img.shields.io/badge/🚀_Try_Now-Online_Version_No_Install-2a82f6?style=for-the-badge" alt="Try Now" /><!--en-->
  </a><!--en-->
  <br><!--en-->
<!--en-->
  <img alt="GitHub Downloads (all assets, all releases)" src="https://img.shields.io/github/downloads/caorushizi/mediago/total"><!--en-->
  <img alt="GitHub Downloads (all assets, latest release)" src="https://img.shields.io/github/downloads/caorushizi/mediago/latest/total"><!--en-->
  <img alt="GitHub Repo stars" src="https://img.shields.io/github/stars/caorushizi/mediago"><!--en-->
  <img alt="GitHub forks" src="https://img.shields.io/github/forks/caorushizi/mediago"><!--en-->
  <img alt="GitCode" src="https://gitcode.com/caorushizi/mediago/star/badge.svg"><!--en-->
  <br><!--en-->
<!--en-->
  <a href="https://trendshift.io/repositories/11083" target="_blank"><!--en-->
    <img src="https://trendshift.io/api/badge/repositories/11083" alt="caorushizi%2Fmediago | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/><!--en-->
  </a><!--en-->
<!--en-->
  <hr /><!--en-->
</div><!--en-->
<!--en-->
A cross-platform video downloader with built-in sniffing — point it at a<!--en-->
page, pick what you want, and save. No packet capture, no browser<!--en-->
extensions to configure, no fiddling with command-line tools.<!--en-->
<!--en-->
The app UI currently ships with English, Simplified Chinese, and Italian.<!--en-->
<!--en-->
## ✨ What's inside<!--en-->
<!--en-->
### 🌐 Browser extension for Chrome / Edge<!--en-->
<!--en-->
See something you want on any site → click the extension → send it to<!--en-->
MediaGo. Detects video resources automatically, shows the count on the<!--en-->
toolbar badge, works with most mainstream video platforms including<!--en-->
YouTube, Bilibili and more. Ships bundled with the Desktop app — open<!--en-->
**Settings → More Settings → Browser extension directory** to find the<!--en-->
install folder.<!--en-->
<!--en-->
### 🎬 YouTube and 1000+ sites<!--en-->
<!--en-->
Powered by yt-dlp under the hood. Supports YouTube, Twitter/X, Instagram,<!--en-->
Reddit and [over a thousand more video sites](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md).<!--en-->
<!--en-->
### 🦞 AI assistants can download for you — OpenClaw Skill<!--en-->
<!--en-->
Using Claude Code, Cursor or another AI coding assistant? Install the<!--en-->
MediaGo skill and just say _"please download this video: &lt;url&gt;"_.<!--en-->
The AI handles the rest.<!--en-->
<!--en-->
```shell<!--en-->
npx clawhub@latest install mediago<!--en-->
```<!--en-->
<!--en-->
### 🔌 Works with other tools<!--en-->
<!--en-->
MediaGo exposes a full HTTP API — scripts, automation tools and other<!--en-->
apps can create download tasks, query progress and manage the list<!--en-->
directly. The browser extension uses this same API to talk to the desktop<!--en-->
app; anyone else can tap in too.<!--en-->
<!--en-->
### 🎞️ Built-in format conversion<!--en-->
<!--en-->
After a download finishes, convert it to another format or quality<!--en-->
without leaving MediaGo. No more opening a separate tool for ffmpeg.<!--en-->
<!--en-->
### 🐳 One-line Docker deployment<!--en-->
<!--en-->
Headless install on your server, then access the web UI from anywhere on<!--en-->
the same network:<!--en-->
<!--en-->
```shell<!--en-->
docker run -d --name mediago -p 8899:8899 -v /path/to/mediago:/app/mediago caorushizi/mediago:3.5.0<!--en-->
```<!--en-->
<!--en-->
Available on [Docker Hub](https://hub.docker.com/r/caorushizi/mediago) and GHCR (`ghcr.io/caorushizi/mediago`) — same image, pick whichever registry is faster for you. Supports both Intel / AMD (amd64) and ARM (arm64). On the desktop build,<!--en-->
MediaGo listens on both `127.0.0.1` and your LAN IP out of the box, so<!--en-->
phones and tablets on the same Wi-Fi can open the web UI too.<!--en-->
<!--en-->
## 📷 Screenshots<!--en-->
<!--en-->
![Home](./images/home_en.png)<!--en-->
<!--en-->
![Home — dark mode](./images/home-dark_en.png)<!--en-->
<!--en-->
![Settings](./images/settings_en.png)<!--en-->
<!--en-->
![Resource extraction](./images/browser_en.png)<!--en-->
<!--en-->
## 📥 Download<!--en-->
<!--en-->
### v3.5.0 (stable)<!--en-->
<!--en-->
- [Windows — installer](https://github.com/caorushizi/mediago/releases/download/v3.5.0/mediago-community-setup-win32-x64-3.5.0.exe)<!--en-->
- [Windows — portable](https://github.com/caorushizi/mediago/releases/download/v3.5.0/mediago-community-portable-win32-x64-3.5.0.exe)<!--en-->
- [macOS — Apple Silicon (arm64)](https://github.com/caorushizi/mediago/releases/download/v3.5.0/mediago-community-setup-darwin-arm64-3.5.0.dmg)<!--en-->
- [macOS — Intel (x64)](https://github.com/caorushizi/mediago/releases/download/v3.5.0/mediago-community-setup-darwin-x64-3.5.0.dmg)<!--en-->
- [Linux (deb)](https://github.com/caorushizi/mediago/releases/download/v3.5.0/mediago-community-setup-linux-amd64-3.5.0.deb)<!--en-->
- [**Docker Hub**](https://hub.docker.com/r/caorushizi/mediago): `docker run -d --name mediago -p 8899:8899 -v /path/to/mediago:/app/mediago caorushizi/mediago:3.5.0`<!--en-->
- **GHCR**: `docker run -d --name mediago -p 8899:8899 -v /path/to/mediago:/app/mediago ghcr.io/caorushizi/mediago:3.5.0`<!--en-->
<!--en-->
Browsing older releases? See the [GitHub Releases page](https://github.com/caorushizi/mediago/releases).<!--en-->
<!--en-->
### 🪄 One-click Docker deployment via BT Panel<!--en-->
<!--en-->
1. Install [BT Panel](https://www.bt.cn/new/download.html?r=dk_mediago) using the official script.<!--en-->
2. Log in to the panel, click **Docker** in the sidebar and finish the<!--en-->
   Docker service setup (just follow the prompts).<!--en-->
3. Find **MediaGo** in the app store, click **Install**, configure your<!--en-->
   domain, and you're done.<!--en-->
<!--en-->
## 📝 What's new in v3.5.0<!--en-->
<!--en-->
- **🌐 Browser extension** — sniff videos on any site, send to MediaGo<!--en-->
  in one click<!--en-->
- **🎬 YouTube + 1000+ sites** — powered by yt-dlp<!--en-->
- **🦞 OpenClaw Skill** — download videos via AI coding assistants<!--en-->
- **🔌 HTTP API** — integrate with scripts, automation and third-party tools<!--en-->
- **🎞️ In-app format conversion** — choose output format and quality<!--en-->
- **🐳 Simpler Docker deployment** — mount a single folder, multi-arch images on GHCR<!--en-->
- **⚡ Faster startup** — backend rewrite, lower memory footprint, built-in video player<!--en-->
<!--en-->
## 🛠️ Built with<!--en-->
<!--en-->
[![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)](https://react.dev/)<!--en-->
[![Electron](https://img.shields.io/badge/Electron-191970?logo=electron&logoColor=white)](https://www.electronjs.org)<!--en-->
[![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)](https://vitejs.dev)<!--en-->
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)<!--en-->
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)<!--en-->
[![shadcn/ui](https://img.shields.io/badge/shadcn%2Fui-000?logo=shadcnui&logoColor=white)](https://ui.shadcn.com/)<!--en-->
[![Go](https://img.shields.io/badge/Go-00ADD8?logo=go&logoColor=white)](https://go.dev/)<!--en-->
[![Ant Design](https://img.shields.io/badge/Ant_Design-0170FE?logo=antdesign&logoColor=white)](https://ant.design)<!--en-->
<!--en-->
## 🙏 Acknowledgements<!--en-->
<!--en-->
- [N_m3u8DL-RE](https://github.com/nilaoda/N_m3u8DL-RE)<!--en-->
- [BBDown](https://github.com/nilaoda/BBDown)<!--en-->
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)<!--en-->
- [aria2](https://aria2.github.io/)<!--en-->
- [mediago-core](https://github.com/caorushizi/mediago-core)<!--en-->
<!--en-->
## ⚖️ Disclaimer<!--en-->
<!--en-->
> **This project is for educational and research purposes only. Do not use it for any commercial or illegal purposes.**<!--en-->
><!--en-->
> 1. All code and functionality provided by this project are intended solely as a reference for learning about streaming media technologies. Users must comply with the laws and regulations of their jurisdiction.<!--en-->
> 2. Any content downloaded using this project remains the property of its original copyright holders. Users should delete downloaded content within 24 hours or obtain proper authorization.<!--en-->
> 3. The developers of this project are not responsible for any actions taken by users, including but not limited to downloading copyrighted content or impacting third-party platforms.<!--en-->
> 4. Using this project for mass scraping, disrupting platform services, or any activity that infringes upon the legitimate rights of others is strictly prohibited.<!--en-->
> 5. By using this project you acknowledge that you have read and agree to this disclaimer. If you do not agree, stop using the project and delete it immediately.<!--en-->
<!--en-->
---<!--en-->
<!--en-->
> Building from source? See [CONTRIBUTING.md](./CONTRIBUTING.md).<!--en-->
><!--en-->
> Translating MediaGo? See [TRANSLATION.md](./TRANSLATION.md).<!--en-->
<div align="center"><!--it-->
  <h1>MediaGo</h1><!--it-->
  <a href="https://downloader.caorushizi.cn/it/guides.html?form=github">Avvio rapido</a><!--it-->
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span><!--it-->
  <a href="https://downloader.caorushizi.cn/it?form=github">Sito web</a><!--it-->
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span><!--it-->
  <a href="https://downloader.caorushizi.cn/it/documents.html?form=github">Documentazione</a><!--it-->
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span><!--it-->
  <a href="https://github.com/caorushizi/mediago/discussions">Discussioni</a><!--it-->
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span><!--it-->
  <a href="https://discord.gg/yxWBVRWGqM">Discord</a><!--it-->
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span><!--it-->
  <a href="https://www.reddit.com/r/MediaGo_Studio/">Reddit</a><!--it-->
  <br><!--it-->
<!--it-->
<a href="https://github.com/caorushizi/mediago/blob/master/README.md">English</a><!--it-->
<span>&nbsp;&nbsp;•&nbsp;&nbsp;</span><!--it-->
<a href="https://github.com/caorushizi/mediago/blob/master/README.zh.md">中文</a><!--it-->
<span>&nbsp;&nbsp;•&nbsp;&nbsp;</span><!--it-->
<a href="https://github.com/caorushizi/mediago/blob/master/README.jp.md">日本語</a><!--it-->
<br><!--it-->
<!--it-->
  <!-- MediaGo Pro --><!--it-->
  <a href="https://mediago.torchstellar.com/?from=github"><!--it-->
    <img src="https://img.shields.io/badge/✨_Nuova_release-MediaGo_Pro-ff6b6b?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiPjxwYXRoIGQ9Ik0xMiAyTDMgN2wzIDMgNi00IDYgNCAzLTMtOS01eiIvPjxwYXRoIGQ9Ik0zIDE3bDkgNSA5LTUtMy0zLTYgNC02LTQtMyAzeiIvPjwvc3ZnPg==" alt="MediaGo Pro" /><!--it-->
  </a><!--it-->
  <a href="https://mediago.torchstellar.com/?from=github"><!--it-->
    <img src="https://img.shields.io/badge/🚀_Provalo_ora-Versione_online_senza_installazione-2a82f6?style=for-the-badge" alt="Provalo ora" /><!--it-->
  </a><!--it-->
  <br><!--it-->
<!--it-->
  <img alt="GitHub Downloads (all assets, all releases)" src="https://img.shields.io/github/downloads/caorushizi/mediago/total"><!--it-->
  <img alt="GitHub Downloads (all assets, latest release)" src="https://img.shields.io/github/downloads/caorushizi/mediago/latest/total"><!--it-->
  <img alt="GitHub Repo stars" src="https://img.shields.io/github/stars/caorushizi/mediago"><!--it-->
  <img alt="GitHub forks" src="https://img.shields.io/github/forks/caorushizi/mediago"><!--it-->
  <img alt="GitCode" src="https://gitcode.com/caorushizi/mediago/star/badge.svg"><!--it-->
  <br><!--it-->
<!--it-->
  <a href="https://trendshift.io/repositories/11083" target="_blank"><!--it-->
    <img src="https://trendshift.io/api/badge/repositories/11083" alt="caorushizi%2Fmediago | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/><!--it-->
  </a><!--it-->
<!--it-->
  <hr /><!--it-->
</div><!--it-->
<!--it-->
Un downloader video multipiattaforma con sniffing integrato: apri una<!--it-->
pagina, scegli la risorsa che ti interessa e salvala. Nessuna cattura dei<!--it-->
pacchetti, nessuna configurazione complicata di estensioni browser, nessuno<!--it-->
strumento da riga di comando da gestire.<!--it-->
<!--it-->
L'interfaccia dell'app include attualmente inglese, cinese semplificato e<!--it-->
italiano.<!--it-->
<!--it-->
## ✨ Cosa include<!--it-->
<!--it-->
### 🌐 Estensione browser per Chrome / Edge<!--it-->
<!--it-->
Trovi un video interessante su un sito qualsiasi → clicchi l'estensione →<!--it-->
lo invii a MediaGo con un clic. Rileva automaticamente le risorse video,<!--it-->
mostra il numero di elementi trovati nel badge della toolbar e funziona con<!--it-->
le principali piattaforme video, incluse YouTube, Bilibili e molte altre.<!--it-->
L'estensione è inclusa nell'app desktop: apri **Impostazioni → Altre<!--it-->
impostazioni → Directory estensione browser** per trovare la cartella di<!--it-->
installazione.<!--it-->
<!--it-->
### 🎬 YouTube e oltre 1000 siti<!--it-->
<!--it-->
Basato su yt-dlp. Supporta YouTube, Twitter/X, Instagram, Reddit e<!--it-->
[oltre mille altri siti video](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md).<!--it-->
<!--it-->
### 🦞 Gli assistenti AI possono scaricare per te — OpenClaw Skill<!--it-->
<!--it-->
Usi Claude Code, Cursor o un altro assistente AI per programmare? Installa<!--it-->
la skill MediaGo e scrivi semplicemente _"please download this video:<!--it-->
&lt;url&gt;"_. L'assistente gestisce il resto.<!--it-->
<!--it-->
```shell<!--it-->
npx clawhub@latest install mediago<!--it-->
```<!--it-->
<!--it-->
### 🔌 Funziona con altri strumenti<!--it-->
<!--it-->
MediaGo espone una API HTTP completa: script, automazioni e app di terze<!--it-->
parti possono creare attività di download, consultare l'avanzamento e<!--it-->
gestire la lista. L'estensione browser usa la stessa API per parlare con<!--it-->
l'app desktop, e puoi integrarla anche nei tuoi workflow.<!--it-->
<!--it-->
### 🎞️ Conversione formato integrata<!--it-->
<!--it-->
Dopo il download puoi convertire il file in un altro formato o qualità<!--it-->
direttamente da MediaGo. Non serve aprire uno strumento ffmpeg separato.<!--it-->
<!--it-->
### 🐳 Deploy Docker con un solo comando<!--it-->
<!--it-->
Installazione headless sul tuo server, poi accesso alla UI web da qualsiasi<!--it-->
dispositivo nella stessa rete:<!--it-->
<!--it-->
```shell<!--it-->
docker run -d --name mediago -p 8899:8899 -v /path/to/mediago:/app/mediago caorushizi/mediago:3.5.0<!--it-->
```<!--it-->
<!--it-->
Disponibile su [Docker Hub](https://hub.docker.com/r/caorushizi/mediago)<!--it-->
e GHCR (`ghcr.io/caorushizi/mediago`): la stessa immagine, scegli il<!--it-->
registry più veloce per te. Supporta Intel / AMD (amd64) e ARM (arm64).<!--it-->
Nella build desktop, MediaGo ascolta sia su `127.0.0.1` sia sull'IP LAN,<!--it-->
così telefoni e tablet sulla stessa rete Wi-Fi possono aprire direttamente<!--it-->
la UI web.<!--it-->
<!--it-->
## 📷 Screenshot<!--it-->
<!--it-->
![Home](./images/home_en.png)<!--it-->
<!--it-->
![Home — modalità scura](./images/home-dark_en.png)<!--it-->
<!--it-->
![Impostazioni](./images/settings_en.png)<!--it-->
<!--it-->
![Estrazione risorse](./images/browser_en.png)<!--it-->
<!--it-->
## 📥 Download<!--it-->
<!--it-->
### v3.5.0 (stabile)<!--it-->
<!--it-->
- [Windows — installer](https://github.com/caorushizi/mediago/releases/download/v3.5.0/mediago-community-setup-win32-x64-3.5.0.exe)<!--it-->
- [Windows — portable](https://github.com/caorushizi/mediago/releases/download/v3.5.0/mediago-community-portable-win32-x64-3.5.0.exe)<!--it-->
- [macOS — Apple Silicon (arm64)](https://github.com/caorushizi/mediago/releases/download/v3.5.0/mediago-community-setup-darwin-arm64-3.5.0.dmg)<!--it-->
- [macOS — Intel (x64)](https://github.com/caorushizi/mediago/releases/download/v3.5.0/mediago-community-setup-darwin-x64-3.5.0.dmg)<!--it-->
- [Linux (deb)](https://github.com/caorushizi/mediago/releases/download/v3.5.0/mediago-community-setup-linux-amd64-3.5.0.deb)<!--it-->
- [**Docker Hub**](https://hub.docker.com/r/caorushizi/mediago): `docker run -d --name mediago -p 8899:8899 -v /path/to/mediago:/app/mediago caorushizi/mediago:3.5.0`<!--it-->
- **GHCR**: `docker run -d --name mediago -p 8899:8899 -v /path/to/mediago:/app/mediago ghcr.io/caorushizi/mediago:3.5.0`<!--it-->
<!--it-->
Per le versioni precedenti, consulta la [pagina GitHub Releases](https://github.com/caorushizi/mediago/releases).<!--it-->
<!--it-->
### 🪄 Deploy Docker con un clic tramite BT Panel<!--it-->
<!--it-->
1. Installa [BT Panel](https://www.bt.cn/new/download.html?r=dk_mediago)<!--it-->
   usando lo script ufficiale.<!--it-->
2. Accedi al pannello, clicca **Docker** nella barra laterale e completa la<!--it-->
   configurazione del servizio Docker seguendo le istruzioni.<!--it-->
3. Trova **MediaGo** nello store delle app, clicca **Install**, configura il<!--it-->
   dominio e hai finito.<!--it-->
<!--it-->
## 📝 Novità in v3.5.0<!--it-->
<!--it-->
- **🌐 Estensione browser** — sniffing video su qualsiasi sito e invio a<!--it-->
  MediaGo con un clic<!--it-->
- **🎬 YouTube + 1000+ siti** — integrazione con yt-dlp<!--it-->
- **🦞 OpenClaw Skill** — scarica video tramite assistenti AI per programmare<!--it-->
- **🔌 API HTTP** — integrazione con script, automazioni e strumenti di terze parti<!--it-->
- **🎞️ Conversione formato in app** — scegli formato e qualità di output<!--it-->
- **🐳 Deploy Docker più semplice** — monta una sola cartella, immagini multi-arch su GHCR<!--it-->
- **⚡ Avvio più rapido** — backend riscritto, minore consumo di memoria, player video integrato<!--it-->
<!--it-->
## 🛠️ Tecnologie<!--it-->
<!--it-->
[![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)](https://react.dev/)<!--it-->
[![Electron](https://img.shields.io/badge/Electron-191970?logo=electron&logoColor=white)](https://www.electronjs.org)<!--it-->
[![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)](https://vitejs.dev)<!--it-->
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)<!--it-->
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)<!--it-->
[![shadcn/ui](https://img.shields.io/badge/shadcn%2Fui-000?logo=shadcnui&logoColor=white)](https://ui.shadcn.com/)<!--it-->
[![Go](https://img.shields.io/badge/Go-00ADD8?logo=go&logoColor=white)](https://go.dev/)<!--it-->
[![Ant Design](https://img.shields.io/badge/Ant_Design-0170FE?logo=antdesign&logoColor=white)](https://ant.design)<!--it-->
<!--it-->
## 🙏 Ringraziamenti<!--it-->
<!--it-->
- [N_m3u8DL-RE](https://github.com/nilaoda/N_m3u8DL-RE)<!--it-->
- [BBDown](https://github.com/nilaoda/BBDown)<!--it-->
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)<!--it-->
- [aria2](https://aria2.github.io/)<!--it-->
- [mediago-core](https://github.com/caorushizi/mediago-core)<!--it-->
<!--it-->
## ⚖️ Disclaimer<!--it-->
<!--it-->
> **Questo progetto è destinato esclusivamente a scopi educativi e di ricerca. Non usarlo per finalità commerciali o illegali.**<!--it-->
><!--it-->
> 1. Tutto il codice e tutte le funzionalità fornite da questo progetto sono pensati solo come riferimento per lo studio delle tecnologie di streaming. Gli utenti devono rispettare le leggi e i regolamenti della propria giurisdizione.<!--it-->
> 2. Qualsiasi contenuto scaricato tramite questo progetto resta di proprietà dei rispettivi titolari dei diritti. Gli utenti devono eliminare i contenuti scaricati entro 24 ore o ottenere un'autorizzazione adeguata.<!--it-->
> 3. Gli sviluppatori del progetto non sono responsabili delle azioni degli utenti, incluso il download di contenuti protetti da copyright o l'impatto su piattaforme di terze parti.<!--it-->
> 4. È vietato usare questo progetto per scraping massivo, interruzione dei servizi delle piattaforme o qualsiasi attività che violi diritti legittimi altrui.<!--it-->
> 5. Usando questo progetto confermi di aver letto e accettato questo disclaimer. Se non lo accetti, interrompi subito l'uso del progetto ed eliminalo.<!--it-->
<!--it-->
---<!--it-->
<!--it-->
> Vuoi compilare da sorgente? Consulta [CONTRIBUTING.md](./CONTRIBUTING.md).<!--it-->
><!--it-->
> Vuoi tradurre MediaGo? Consulta [TRANSLATION.md](./TRANSLATION.md).<!--it-->
<div align="center"><!--jp-->
  <h1>MediaGo</h1><!--jp-->
  <a href="https://downloader.caorushizi.cn/jp/guides.html?form=github">クイックスタート</a><!--jp-->
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span><!--jp-->
  <a href="https://downloader.caorushizi.cn/jp?form=github">公式サイト</a><!--jp-->
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span><!--jp-->
  <a href="https://downloader.caorushizi.cn/jp/documents.html?form=github">ドキュメント</a><!--jp-->
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span><!--jp-->
  <a href="https://github.com/caorushizi/mediago/discussions">Discussions</a><!--jp-->
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span><!--jp-->
  <a href="https://discord.gg/yxWBVRWGqM">Discord</a><!--jp-->
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span><!--jp-->
  <a href="https://www.reddit.com/r/MediaGo_Studio/">Reddit</a><!--jp-->
  <br><!--jp-->
<!--jp-->
<a href="https://github.com/caorushizi/mediago/blob/master/README.md">English</a><!--jp-->
<span>&nbsp;&nbsp;•&nbsp;&nbsp;</span><!--jp-->
<a href="https://github.com/caorushizi/mediago/blob/master/README.zh.md">中文</a><!--jp-->
<span>&nbsp;&nbsp;•&nbsp;&nbsp;</span><!--jp-->
<a href="https://github.com/caorushizi/mediago/blob/master/README.it.md">Italiano</a><!--jp-->
<br><!--jp-->
<!--jp-->
  <!-- MediaGo Pro --><!--jp-->
  <a href="https://mediago.torchstellar.com/?from=github"><!--jp-->
    <img src="https://img.shields.io/badge/✨_新登場-MediaGo_Pro-ff6b6b?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiPjxwYXRoIGQ9Ik0xMiAyTDMgN2wzIDMgNi00IDYgNCAzLTMtOS01eiIvPjxwYXRoIGQ9Ik0zIDE3bDkgNSA5LTUtMy0zLTYgNC02LTQtMyAzeiIvPjwvc3ZnPg==" alt="MediaGo Pro" /><!--jp-->
  </a><!--jp-->
  <a href="https://mediago.torchstellar.com/?from=github"><!--jp-->
    <img src="https://img.shields.io/badge/🚀_今すぐ試す-オンライン版_インストール不要-2a82f6?style=for-the-badge" alt="Try Now" /><!--jp-->
  </a><!--jp-->
  <br><!--jp-->
<!--jp-->
  <img alt="GitHub Downloads (all assets, all releases)" src="https://img.shields.io/github/downloads/caorushizi/mediago/total"><!--jp-->
  <img alt="GitHub Downloads (all assets, latest release)" src="https://img.shields.io/github/downloads/caorushizi/mediago/latest/total"><!--jp-->
  <img alt="GitHub Repo stars" src="https://img.shields.io/github/stars/caorushizi/mediago"><!--jp-->
  <img alt="GitHub forks" src="https://img.shields.io/github/forks/caorushizi/mediago"><!--jp-->
  <img alt="GitCode" src="https://gitcode.com/caorushizi/mediago/star/badge.svg"><!--jp-->
  <br><!--jp-->
<!--jp-->
  <a href="https://trendshift.io/repositories/11083" target="_blank"><!--jp-->
    <img src="https://trendshift.io/api/badge/repositories/11083" alt="caorushizi%2Fmediago | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/><!--jp-->
  </a><!--jp-->
<!--jp-->
  <hr /><!--jp-->
</div><!--jp-->
<!--jp-->
ビルトインのスニッフィング機能を備えたクロスプラットフォームの動画ダウンローダー —— ページを開いて、欲しいリソースを選んで、保存するだけ。パケットキャプチャ不要、ブラウザ拡張の設定不要、コマンドラインの操作も不要です。<!--jp-->
<!--jp-->
アプリ UI は現在、英語・簡体中国語・イタリア語に対応しています。<!--jp-->
<!--jp-->
## ✨ 主な機能<!--jp-->
<!--jp-->
### 🌐 ブラウザ拡張機能（Chrome / Edge）<!--jp-->
<!--jp-->
ウェブを閲覧中に気になる動画を見つけたら → 拡張機能のアイコンをクリック → ワンクリックで MediaGo に送信。ページ内のダウンロード可能なリソースを自動検出し、ツールバーアイコンのバッジに件数を表示します。YouTube、Bilibili をはじめ主要な動画サイトに対応。拡張機能はデスクトップ版インストーラーに同梱されているので、**設定 → その他の設定 → ブラウザ拡張ディレクトリ** から直接インストールフォルダを開けます。<!--jp-->
<!--jp-->
### 🎬 YouTube と 1000+ サイト対応<!--jp-->
<!--jp-->
内部では yt-dlp を使用。YouTube、Twitter/X、Instagram、Reddit など [1000 以上の動画サイト](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md) をサポートします。<!--jp-->
<!--jp-->
### 🦞 AI アシスタントで動画をダウンロード — OpenClaw Skill<!--jp-->
<!--jp-->
Claude Code や Cursor などの AI コーディングアシスタントを使っていますか？MediaGo Skill をインストールすれば、AI に「この動画をダウンロードして：&lt;URL&gt;」と言うだけでダウンロードが始まります。<!--jp-->
<!--jp-->
```shell<!--jp-->
npx clawhub@latest install mediago<!--jp-->
```<!--jp-->
<!--jp-->
### 🔌 他のツールと連携<!--jp-->
<!--jp-->
MediaGo は完全な HTTP API を提供します。スクリプト、自動化ツール、他のアプリから直接ダウンロードタスクの作成、進捗の取得、リスト管理が可能です。ブラウザ拡張機能はこの API を介してデスクトップアプリと通信しており、自分のワークフローに組み込むこともできます。<!--jp-->
<!--jp-->
### 🎞️ 内蔵フォーマット変換<!--jp-->
<!--jp-->
ダウンロード完了後、MediaGo 内で他のフォーマットや画質に変換できます。ffmpeg を別途起動する必要はありません。<!--jp-->
<!--jp-->
### 🐳 Docker でワンライン展開<!--jp-->
<!--jp-->
サーバーにヘッドレスでインストールし、同じネットワーク内のどこからでも Web UI にアクセスできます：<!--jp-->
<!--jp-->
```shell<!--jp-->
docker run -d --name mediago -p 8899:8899 -v /path/to/mediago:/app/mediago caorushizi/mediago:3.5.0<!--jp-->
```<!--jp-->
<!--jp-->
[Docker Hub](https://hub.docker.com/r/caorushizi/mediago) と GHCR（`ghcr.io/caorushizi/mediago`）の両方で配信しています。同じイメージなのでお好みのレジストリを。Intel / AMD (amd64) と ARM (arm64) の両方に対応。デスクトップ版は `127.0.0.1` と LAN IP の両方で待ち受けるため、同じ Wi-Fi のスマートフォンやタブレットからも Web UI を開けます。<!--jp-->
<!--jp-->
## 📷 スクリーンショット<!--jp-->
<!--jp-->
![ホームページ](./images/home.png)<!--jp-->
<!--jp-->
![ホームページ — ダークモード](./images/home-dark.png)<!--jp-->
<!--jp-->
![設定](./images/settings.png)<!--jp-->
<!--jp-->
![リソース抽出](./images/browser.png)<!--jp-->
<!--jp-->
## 📥 ダウンロード<!--jp-->
<!--jp-->
### v3.5.0（安定版）<!--jp-->
<!--jp-->
- [Windows — インストーラー版](https://github.com/caorushizi/mediago/releases/download/v3.5.0/mediago-community-setup-win32-x64-3.5.0.exe)<!--jp-->
- [Windows — ポータブル版](https://github.com/caorushizi/mediago/releases/download/v3.5.0/mediago-community-portable-win32-x64-3.5.0.exe)<!--jp-->
- [macOS — Apple Silicon (arm64)](https://github.com/caorushizi/mediago/releases/download/v3.5.0/mediago-community-setup-darwin-arm64-3.5.0.dmg)<!--jp-->
- [macOS — Intel (x64)](https://github.com/caorushizi/mediago/releases/download/v3.5.0/mediago-community-setup-darwin-x64-3.5.0.dmg)<!--jp-->
- [Linux (deb)](https://github.com/caorushizi/mediago/releases/download/v3.5.0/mediago-community-setup-linux-amd64-3.5.0.deb)<!--jp-->
- [**Docker Hub**](https://hub.docker.com/r/caorushizi/mediago)：`docker run -d --name mediago -p 8899:8899 -v /path/to/mediago:/app/mediago caorushizi/mediago:3.5.0`<!--jp-->
- **GHCR**：`docker run -d --name mediago -p 8899:8899 -v /path/to/mediago:/app/mediago ghcr.io/caorushizi/mediago:3.5.0`<!--jp-->
<!--jp-->
過去のバージョンは [GitHub Releases ページ](https://github.com/caorushizi/mediago/releases) をご覧ください。<!--jp-->
<!--jp-->
### 🪄 宝塔パネルでワンクリック Docker デプロイ<!--jp-->
<!--jp-->
1. [宝塔パネル公式サイト](https://www.bt.cn/new/download.html?r=dk_mediago) から正式版のスクリプトをダウンロードしてインストール<!--jp-->
2. 宝塔パネルにログイン、メニューから **Docker** をクリック。初回アクセス時に Docker サービスのインストールを求められるので、「今すぐインストール」をクリックして完了<!--jp-->
3. アプリストアで **MediaGo** を見つけて、インストールをクリック、ドメインなどの基本情報を設定すれば完了<!--jp-->
<!--jp-->
## 📝 v3.5.0 の新機能<!--jp-->
<!--jp-->
- **🌐 ブラウザ拡張機能** — 任意のサイトで動画をスニッフィング、ワンクリックで MediaGo に送信<!--jp-->
- **🎬 YouTube + 1000+ サイト** — yt-dlp による対応<!--jp-->
- **🦞 OpenClaw Skill** — AI コーディングアシスタント経由でダウンロード<!--jp-->
- **🔌 HTTP API** — スクリプト、自動化、サードパーティツールとの統合<!--jp-->
- **🎞️ アプリ内フォーマット変換** — 出力形式と画質を選択<!--jp-->
- **🐳 Docker デプロイの簡素化** — 単一ディレクトリをマウント、GHCR のマルチアーキテクチャイメージ<!--jp-->
- **⚡ 起動の高速化** — バックエンド書き換え、メモリ使用量の削減、内蔵動画プレーヤー<!--jp-->
<!--jp-->
## 🛠️ 技術スタック<!--jp-->
<!--jp-->
[![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)](https://react.dev/)<!--jp-->
[![Electron](https://img.shields.io/badge/Electron-191970?logo=electron&logoColor=white)](https://www.electronjs.org)<!--jp-->
[![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)](https://vitejs.dev)<!--jp-->
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)<!--jp-->
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)<!--jp-->
[![shadcn/ui](https://img.shields.io/badge/shadcn%2Fui-000?logo=shadcnui&logoColor=white)](https://ui.shadcn.com/)<!--jp-->
[![Go](https://img.shields.io/badge/Go-00ADD8?logo=go&logoColor=white)](https://go.dev/)<!--jp-->
[![Ant Design](https://img.shields.io/badge/Ant_Design-0170FE?logo=antdesign&logoColor=white)](https://ant.design)<!--jp-->
<!--jp-->
## 🙏 謝辞<!--jp-->
<!--jp-->
- [N_m3u8DL-RE](https://github.com/nilaoda/N_m3u8DL-RE)<!--jp-->
- [BBDown](https://github.com/nilaoda/BBDown)<!--jp-->
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)<!--jp-->
- [aria2](https://aria2.github.io/)<!--jp-->
- [mediago-core](https://github.com/caorushizi/mediago-core)<!--jp-->
<!--jp-->
## ⚖️ 免責事項<!--jp-->
<!--jp-->
> **本プロジェクトは学習および研究目的にのみ提供されるものであり、商用または違法な目的での使用はご遠慮ください。**<!--jp-->
><!--jp-->
> 1. 本プロジェクトが提供するすべてのコードおよび機能は、ストリーミング技術の学習のための参考資料としてのみ使用されます。利用者は所在地域の法令を遵守してください。<!--jp-->
> 2. 本プロジェクトを使用してダウンロードされたコンテンツの著作権は、原コンテンツの所有者に帰属します。利用者はダウンロード後 24 時間以内にコンテンツを削除するか、著作権者の許可を取得する必要があります。<!--jp-->
> 3. 本プロジェクトの開発者は、著作権で保護されたコンテンツのダウンロードや第三者プラットフォームへの影響を含め、利用者の行動に対して一切の責任を負いません。<!--jp-->
> 4. 大規模なスクレイピング、プラットフォームサービスの妨害、その他他者の合法的権利を侵害する行為に本プロジェクトを使用することは禁止されています。<!--jp-->
> 5. 本プロジェクトを使用することにより、あなたはこの免責事項を読み、同意したものとみなされます。同意しない場合は、直ちに本プロジェクトの使用を停止し、削除してください。<!--jp-->
<!--jp-->
---<!--jp-->
<!--jp-->
> ソースからビルドする場合は [CONTRIBUTING.md](./CONTRIBUTING.md)（英語）を参照してください。<!--jp-->
><!--jp-->
> MediaGo の翻訳をご検討中の方は [TRANSLATION.md](./TRANSLATION.md)（英語）をご参照ください。<!--jp-->
<div align="center"><!--zh-->
  <h1>MediaGo</h1><!--zh-->
  <a href="https://downloader.caorushizi.cn/guides.html?form=github">快速开始</a><!--zh-->
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span><!--zh-->
  <a href="https://downloader.caorushizi.cn?form=github">官网</a><!--zh-->
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span><!--zh-->
  <a href="https://downloader.caorushizi.cn/documents.html?form=github">文档</a><!--zh-->
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span><!--zh-->
  <a href="https://github.com/caorushizi/mediago/discussions">Discussions</a><!--zh-->
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span><!--zh-->
  <a href="https://discord.gg/yxWBVRWGqM">Discord</a><!--zh-->
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span><!--zh-->
  <a href="https://www.reddit.com/r/MediaGo_Studio/">Reddit</a><!--zh-->
  <br><!--zh-->
<!--zh-->
<a href="https://github.com/caorushizi/mediago/blob/master/README.md">English</a><!--zh-->
<span>&nbsp;&nbsp;•&nbsp;&nbsp;</span><!--zh-->
<a href="https://github.com/caorushizi/mediago/blob/master/README.jp.md">日本語</a><!--zh-->
<span>&nbsp;&nbsp;•&nbsp;&nbsp;</span><!--zh-->
<a href="https://github.com/caorushizi/mediago/blob/master/README.it.md">Italiano</a><!--zh-->
<br><!--zh-->
<!--zh-->
  <!-- MediaGo Pro 推广 --><!--zh-->
  <a href="https://mediago.torchstellar.com/?from=github"><!--zh-->
    <img src="https://img.shields.io/badge/✨_全新发布-MediaGo_Pro-ff6b6b?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiPjxwYXRoIGQ9Ik0xMiAyTDMgN2wzIDMgNi00IDYgNCAzLTMtOS01eiIvPjxwYXRoIGQ9Ik0zIDE3bDkgNSA5LTUtMy0zLTYgNC02LTQtMyAzeiIvPjwvc3ZnPg==" alt="MediaGo Pro" /><!--zh-->
  </a><!--zh-->
  <a href="https://mediago.torchstellar.com/?from=github"><!--zh-->
    <img src="https://img.shields.io/badge/🚀_立即体验-在线版本_无需安装-2a82f6?style=for-the-badge" alt="Try Now" /><!--zh-->
  </a><!--zh-->
  <br><!--zh-->
<!--zh-->
  <img alt="GitHub Downloads (all assets, all releases)" src="https://img.shields.io/github/downloads/caorushizi/mediago/total"><!--zh-->
  <img alt="GitHub Downloads (all assets, latest release)" src="https://img.shields.io/github/downloads/caorushizi/mediago/latest/total"><!--zh-->
  <img alt="GitHub Repo stars" src="https://img.shields.io/github/stars/caorushizi/mediago"><!--zh-->
  <img alt="GitHub forks" src="https://img.shields.io/github/forks/caorushizi/mediago"><!--zh-->
  <img alt="GitCode" src="https://gitcode.com/caorushizi/mediago/star/badge.svg"><!--zh-->
  <br><!--zh-->
<!--zh-->
  <a href="https://trendshift.io/repositories/11083" target="_blank"><!--zh-->
    <img src="https://trendshift.io/api/badge/repositories/11083" alt="caorushizi%2Fmediago | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/><!--zh-->
  </a><!--zh-->
<!--zh-->
  <hr /><!--zh-->
</div><!--zh-->
<!--zh-->
跨平台视频下载器，内置嗅探 —— 打开网页、选一下想要的资源、保存完事。不用抓包、不用折腾浏览器插件、不用面对命令行。<!--zh-->
<!--zh-->
应用界面目前内置中文、英文和意大利语。<!--zh-->
<!--zh-->
## ✨ 主打功能<!--zh-->
<!--zh-->
### 🌐 浏览器扩展（Chrome / Edge）<!--zh-->
<!--zh-->
浏览网页时遇到想下的视频 → 点扩展图标 → 一键发到 MediaGo。自动识别页面里的可下载资源，工具栏图标显示检测到的数量，主流视频网站（包括 YouTube、Bilibili 等）都能覆盖。扩展随桌面端安装包一起打包，在 **设置 → 更多设置 → 浏览器扩展目录** 就能找到安装文件夹。<!--zh-->
<!--zh-->
### 🎬 支持 YouTube 和 1000+ 站点<!--zh-->
<!--zh-->
底层用的是 yt-dlp。支持 YouTube、Twitter/X、Instagram、Reddit 等 [一千多个视频站点](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md)。<!--zh-->
<!--zh-->
### 🦞 让 AI 助手帮你下载 —— OpenClaw Skill<!--zh-->
<!--zh-->
在用 Claude Code、Cursor 等 AI 编程助手？装上 MediaGo Skill 后直接跟 AI 说"帮我下载这个视频：&lt;链接&gt;"就行，剩下的交给 AI。<!--zh-->
<!--zh-->
```shell<!--zh-->
npx clawhub@latest install mediago<!--zh-->
```<!--zh-->
<!--zh-->
### 🔌 可以和其他工具联动<!--zh-->
<!--zh-->
MediaGo 提供一整套 HTTP 接口 —— 脚本、自动化工具、其他 App 都能直接调用 MediaGo 创建下载任务、查询进度、管理列表。浏览器扩展就是通过这套接口和桌面端对话的，你也可以接入自己的工作流。<!--zh-->
<!--zh-->
### 🎞️ 内置格式转换<!--zh-->
<!--zh-->
下载完成后可以直接在 MediaGo 里转换格式、选画质，不用再打开别的软件。<!--zh-->
<!--zh-->
### 🐳 Docker 一键部署<!--zh-->
<!--zh-->
服务器端一条命令部署，局域网内任意设备都能打开 Web 界面：<!--zh-->
<!--zh-->
```shell<!--zh-->
docker run -d --name mediago -p 8899:8899 -v /path/to/mediago:/app/mediago caorushizi/mediago:3.5.0<!--zh-->
```<!--zh-->
<!--zh-->
在 [Docker Hub](https://hub.docker.com/r/caorushizi/mediago) 和 GHCR（`ghcr.io/caorushizi/mediago`）上同步发布 —— 同一份镜像，哪个源更快用哪个。支持 Intel / AMD (amd64) 和 ARM (arm64) 两种架构。桌面版同时监听 `127.0.0.1` 和局域网 IP，同一个 Wi-Fi 下的手机、平板可以直接打开 Web 界面。<!--zh-->
<!--zh-->
## 📷 软件截图<!--zh-->
<!--zh-->
![首页](./images/home.png)<!--zh-->
<!--zh-->
![首页 — 深色模式](./images/home-dark.png)<!--zh-->
<!--zh-->
![设置](./images/settings.png)<!--zh-->
<!--zh-->
![资源提取](./images/browser.png)<!--zh-->
<!--zh-->
## 📥 下载<!--zh-->
<!--zh-->
### v3.5.0（正式版）<!--zh-->
<!--zh-->
- [Windows — 安装版](https://github.com/caorushizi/mediago/releases/download/v3.5.0/mediago-community-setup-win32-x64-3.5.0.exe)<!--zh-->
- [Windows — 便携版](https://github.com/caorushizi/mediago/releases/download/v3.5.0/mediago-community-portable-win32-x64-3.5.0.exe)<!--zh-->
- [macOS — Apple Silicon (arm64)](https://github.com/caorushizi/mediago/releases/download/v3.5.0/mediago-community-setup-darwin-arm64-3.5.0.dmg)<!--zh-->
- [macOS — Intel (x64)](https://github.com/caorushizi/mediago/releases/download/v3.5.0/mediago-community-setup-darwin-x64-3.5.0.dmg)<!--zh-->
- [Linux (deb)](https://github.com/caorushizi/mediago/releases/download/v3.5.0/mediago-community-setup-linux-amd64-3.5.0.deb)<!--zh-->
- [**Docker Hub**](https://hub.docker.com/r/caorushizi/mediago)：`docker run -d --name mediago -p 8899:8899 -v /path/to/mediago:/app/mediago caorushizi/mediago:3.5.0`<!--zh-->
- **GHCR**：`docker run -d --name mediago -p 8899:8899 -v /path/to/mediago:/app/mediago ghcr.io/caorushizi/mediago:3.5.0`<!--zh-->
<!--zh-->
查看历史版本请移步 [GitHub Releases](https://github.com/caorushizi/mediago/releases)。<!--zh-->
<!--zh-->
### 🪄 宝塔面板一键部署 Docker<!--zh-->
<!--zh-->
1. 安装宝塔面板，前往 [宝塔面板官网](https://www.bt.cn/new/download.html?r=dk_mediago) 选择正式版的脚本下载安装<!--zh-->
2. 登录宝塔面板，在菜单栏中点击 **Docker**，首次进入会提示安装 Docker 服务，点击立即安装并按提示完成<!--zh-->
3. 在应用商店中找到 **MediaGo**，点击安装，配置域名等基本信息即可<!--zh-->
<!--zh-->
## 📝 v3.5.0 更新要点<!--zh-->
<!--zh-->
- **🌐 浏览器扩展**：任意网站一键嗅探视频、一键发到 MediaGo<!--zh-->
- **🎬 YouTube + 1000+ 站点**：集成 yt-dlp<!--zh-->
- **🦞 OpenClaw Skill**：通过 AI 编程助手下载视频<!--zh-->
- **🔌 开放 HTTP 接口**：接入脚本、自动化工具和其他应用<!--zh-->
- **🎞️ 内置格式转换**：选输出格式和画质<!--zh-->
- **🐳 Docker 部署简化**：挂载一个目录即可，多架构镜像已迁至 GHCR<!--zh-->
- **⚡ 启动更快**：后端重写，资源占用更低，内置视频播放器<!--zh-->
<!--zh-->
## 🛠️ 技术栈<!--zh-->
<!--zh-->
[![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)](https://react.dev/)<!--zh-->
[![Electron](https://img.shields.io/badge/Electron-191970?logo=electron&logoColor=white)](https://www.electronjs.org)<!--zh-->
[![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)](https://vitejs.dev)<!--zh-->
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)<!--zh-->
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)<!--zh-->
[![shadcn/ui](https://img.shields.io/badge/shadcn%2Fui-000?logo=shadcnui&logoColor=white)](https://ui.shadcn.com/)<!--zh-->
[![Go](https://img.shields.io/badge/Go-00ADD8?logo=go&logoColor=white)](https://go.dev/)<!--zh-->
[![Ant Design](https://img.shields.io/badge/Ant_Design-0170FE?logo=antdesign&logoColor=white)](https://ant.design)<!--zh-->
<!--zh-->
## 🙏 鸣谢<!--zh-->
<!--zh-->
- [N_m3u8DL-RE](https://github.com/nilaoda/N_m3u8DL-RE)<!--zh-->
- [BBDown](https://github.com/nilaoda/BBDown)<!--zh-->
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)<!--zh-->
- [aria2](https://aria2.github.io/)<!--zh-->
- [mediago-core](https://github.com/caorushizi/mediago-core)<!--zh-->
<!--zh-->
## ⚖️ 免责声明<!--zh-->
<!--zh-->
> **本项目仅供学习和研究使用，请勿用于任何商业或非法用途。**<!--zh-->
><!--zh-->
> 1. 本项目提供的所有代码和功能仅作为学习流媒体技术的参考，使用者需自行遵守所在地区的法律法规。<!--zh-->
> 2. 使用本项目下载的任何内容，其版权归原始内容所有者所有。使用者应在下载后 24 小时内删除，或取得版权方授权。<!--zh-->
> 3. 本项目开发者不对使用者的任何行为承担责任，包括但不限于：下载受版权保护的内容、对第三方平台造成的影响等。<!--zh-->
> 4. 禁止将本项目用于大规模抓取、破坏平台服务或任何侵犯他人合法权益的行为。<!--zh-->
> 5. 使用本项目即表示您已阅读并同意本免责声明。如不同意，请立即停止使用并删除本项目。<!--zh-->
<!--zh-->
---<!--zh-->
<!--zh-->
> 想从源码构建？见 [CONTRIBUTING.md](./CONTRIBUTING.md)（英文）。<!--zh-->
><!--zh-->
> 想为 MediaGo 做翻译？见 [TRANSLATION.md](./TRANSLATION.md)（英文）。<!--zh-->
