import type { ExtensionResources } from "./zh";

const resource: ExtensionResources = {
  popup: {
    header: "Sniffer MediaGo",
    workspaceLabel: "Area risorse",
    pageContext: "Pagina corrente",
    untitledPage: "Pagina senza titolo",
    noPageUrl: "URL pagina non disponibile",
    detectedCount_one: "{{count}} risorsa rilevata",
    detectedCount_other: "{{count}} risorse rilevate",
    resourceList: "Risorse rilevate",
    clear: "Azzera",
    clearLabel: "Azzera le risorse rilevate",
    importAll: "Importa tutto",
    importAllWithCount: "Importa tutto ({{count}})",
    importing: "Importazione risorse",
    settings: "Impostazioni",
    imported: "Importate {{count}} attività",
    importFailed: "Importazione fallita",
    loadingTitle: "Analisi della pagina",
    loadErrorTitle: "Impossibile caricare le risorse",
    loadErrorHint:
      "L'estensione non è riuscita a leggere questa pagina. Riprova.",
    retry: "Riprova",
    setupTitle: "Completa la configurazione",
    setupHint:
      "Aggiungi l'indirizzo del server MediaGo prima di importare le risorse rilevate.",
    openConnectionSettings: "Apri impostazioni connessione",
    connectionErrorTitle: "MediaGo è offline",
    connectionErrorHint:
      "Controlla che MediaGo sia in esecuzione e che le impostazioni di connessione siano corrette.",
  },
  status: {
    detecting: "Rilevamento",
    unavailable: "Stato non disponibile",
    schemaMode: "Modo schema",
    notConfigured: "Non configurato",
    connectionFailed: "Connessione fallita",
  },
  empty: {
    title: "Nessuna risorsa scaricabile rilevata in questa pagina.",
    hint: "Durante la navigazione le sorgenti corrispondenti vengono visualizzate automaticamente qui.",
    reloadPage: "Ricarica la pagina corrente",
    openSettings: "Apri impostazioni",
  },
  source: {
    unnamed: "(senza titolo)",
    import: "Importa",
    importNamed: "Importa {{name}}",
    inspecting: "Analisi in corso",
    autoBest: "Migliore automatico",
    qualityUnknown: "Qualità sconosciuta",
  },
  options: {
    pageTitle: "Impostazioni estensione MediaGo",
    workspaceLabel: "Area di lavoro browser",
    settingsLabel: "Impostazioni",
    description:
      "Configura come inviare a MediaGo le risorse rilevate e gestisci le preferenze dell'estensione.",
    preferencesLabel: "Preferenze estensione",
    loadingTitle: "Caricamento impostazioni",
    loadErrorTitle: "Impossibile caricare le impostazioni",
    loadErrorHint:
      "L'estensione non riesce a leggere le impostazioni salvate. Prova a ricaricarle.",
    retry: "Riprova",
    language: {
      title: "Lingua interfaccia",
      description: `Lingua usata dal popup e dalla pagina delle opzioni. Scelte "Usa stessa lingua sistema" in base alla lingua dell'interfaccia utente del browser.`,
      system: "Usa stessa lingua sistema",
      zh: "中文",
      en: "English",
      it: "Italiano",
      zhTW: "Cinese tradizionale",
    },
    server: {
      title: "Modalità spedizione",
      eyebrow: "Connessione",
      modeLegend: "Modalità di connessione MediaGo",
      description:
        "Scegli un percorso esplicito per inviare le risorse rilevate a MediaGo. Gli errori restano visibili finché non risolvi la connessione o cambi modalità.",
      modeSchemaTitle: "Desktop / Protocollo schema",
      modeSchemaDesc:
        "Apre MediaGo Desktop tramite mediago-community:// e mostra una finestra di revisione precompilata. Desktop viene avviato automaticamente se necessario.",
      modeDesktopHttpTitle: "Desktop / HTTP locale",
      modeDesktopHttpDesc:
        "Parla con l'app desktop in esecuzione tramite {{base}}. Richiede che l'app desktop sia in esecuzione, ma non c'è nessuna finestra di conferma.",
      modeDockerHttpTitle: "Docker / HTTP self-hosted",
      modeDockerHttpDesc:
        "Connettiti ad una distribuzione Docker remota o a qualsiasi server MediaGo self-hosted. Richiede una URL del server; quando l'autenticazione è abilitata aggiungi una chiave API.",
      serverUrlLabel: "URL server",
      serverUrlPlaceholder: "http://your-host:8899",
      apiKeyLabel: "Chiave API",
      apiKeyOptional: "(opzionale)",
      apiKeyPlaceholder: "Lascia vuoto per saltare l'intestazione X-API-Key",
      schemaNoteLead: "Usa il nuovo",
      schemaNoteBody:
        "protocollo Share Intent per aprire MediaGo Desktop con una finestra di revisione.",
      schemaNoteMid:
        "protocollo Share Intent per richiamare Desktop. La scheda attiva apre l'URL del protocollo. Quando Chrome mostra per la prima volta 'Apri MediaGo-community?', scegli",
      schemaAllow: "Consenti",
      schemaAlways: "Consenti sempre",
      schemaAfter:
        "così Chrome non chiederà più; MediaGo mostrerà comunque la finestra di revisione.",
      limitationLabel: "Limitazione",
      limitationBody:
        "Lo schema invia un'attività senza intestazioni. Usa HTTP per batch o sorgenti che richiedono intestazioni.",
      desktopHttpNoteLead: "Collegati sempre a",
      desktopHttpNoteTail:
        ". Il desktop ascolta automaticamente all'avvio; per verificare che sia online usa 'Verifica connessione'.",
    },
    importBehaviour: {
      title: "Comportamento importazione",
      httpDescription:
        "Le modalità HTTP possono aggiungere attività direttamente e avviare subito il download.",
      schemaReviewOnly:
        "La modalità Schema apre MediaGo con una finestra di revisione e non crea né avvia attività automaticamente.",
      schemaDisabled:
        "Il download immediato non è disponibile perché la modalità Schema apre sempre la finestra di revisione.",
      downloadNowLabel: "Avvia immediatamente download",
      downloadNowDesc:
        "ON: l'attività viene aggiunta e avviata. OFF: viene solo aggiunta all'elenco. Si applica solo alle modalità HTTP.",
    },
    pageQuickAction: {
      title: "Scorciatoia pagina",
      description:
        "Mostra “Aggiungi a MediaGo” nell'angolo in alto a destra delle pagine supportate.",
      enabledLabel: "Mostra la scorciatoia pagina",
      enabledDescription:
        "Il clic aggiunge la pagina corrente all'elenco del popup dell'estensione e lo apre.",
    },
    rules: {
      title: "Regole sniffing",
      description:
        "Una panoramica compatta dei modelli di risorse condivisi con MediaGo Desktop.",
      descriptionLead: "Le regole vengono mantenute centralmente in",
      descriptionTail:
        "e condivise tra app desktop e l'estensione del browser.",
      m3u8Label: "Stream HLS/m3u8",
      directLabel: "File multimediali diretti",
      bilibiliLabel: "Pagine video Bilibili",
      youtubeLabel: "YouTube",
    },
    about: {
      title: "Informazioni",
      productName: "Estensione MediaGo",
      description: "Assistente di acquisizione multimediale per MediaGo",
      version: "Versione {{version}}",
    },
  },
  common: {
    close: "Chiudi",
    notifications: "Notifiche",
    save: "Salva",
    saved: "Salvato",
    saveFailed: "Impossibile salvare",
    testConnection: "Test connessione",
    testing: "Test in corso",
    saving: "Salvataggio",
  },
  errors: {
    serverUrlRequired: "Prima inserisci l'URL del server",
    dockerServerRequired: "La modalità Docker richiede una URL del server",
    schemaBatchNotSupported:
      "La modalità schema può inviare solo un'attività alla volta. Per le importazioni batch passa alla modalità HTTP (pagina Opzioni).",
    schemaNoActiveTab:
      "Nessuna scheda attiva nella finestra attuale: impossibile richiamare il protocollo",
    schemaHeadersNotSupported:
      "La modalità Schema non invia le intestazioni; usa la modalità HTTP per questa sorgente.",
    schemaInvoked:
      "Invocato mediago-community://: se la finestra desktop non viene visualizzata, assicurati che MediaGo Desktop sia installato.",
    serverNotConfigured: "Server MediaGo non configurato",
    dockerNotConfigured:
      "La modalità Docker non ha ancora un URL del server- configura il server nella pagina delle opzioni.",
    unknown: "{{detail}}",
  },
};

export default resource;
