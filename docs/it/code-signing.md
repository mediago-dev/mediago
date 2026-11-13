---
layout: doc
outline: deep
---

# Code signing policy

Aggiornata il 13 novembre 2026.

MediaGo è stato accettato nel programma open source di [SignPath Foundation](https://signpath.org/), ma il progetto non dispone ancora di un certificato di firma di produzione. **Le versioni pubbliche per Windows non usano ancora la firma SignPath.** L'integrazione della firma di test è mantenuta nel branch separato [codex/signpath-integration](https://github.com/mediago-dev/mediago/tree/codex/signpath-integration) per lo sviluppo e la verifica. Gli installer Windows pubblici attuali e le versioni precedenti non firmate, incluso 3.6.0-beta.1, restano non firmati. I pacchetti con firma di test non sono distribuiti nei canali di aggiornamento stabile o beta. La firma e notarizzazione macOS sono separate.

La prima versione firmata sarà identificata nella pagina di download e nelle note di rilascio, con identità verificata dell’editore e istruzioni. Una firma non certifica l’assenza di difetti.

## Origine e approvazione

Gli artefatti devono essere riconducibili a sorgenti revisionati di [mediago-dev/mediago](https://github.com/mediago-dev/mediago) e a build ospitate da GitHub. Firma di produzione e pubblicazione richiedono approvazione umana; l’automazione di manutenzione non approva le firme di produzione.

Il manutentore e contatto iniziale per l’approvazione è [caorushizi](https://github.com/caorushizi). Autori e revisori sono i manutentori autorizzati. I ruoli di firma devono essere assegnati esplicitamente e usare MFA su GitHub e SignPath. Le modifiche al processo di firma richiedono revisione.

## Ambito e verifica

La politica riguarda solo gli artefatti MediaGo approvati. Gli strumenti di terzi mantengono origine e licenze upstream: includerli non li rende software scritto da MediaGo o prova che ogni file sia firmato. Vedi gli [avvisi di terzi](https://github.com/mediago-dev/mediago/blob/master/THIRD_PARTY_NOTICES.md).

Il processo previsto dovrà verificare editore Authenticode, marca temporale e artefatti finali, rifiutando aggiornamenti non firmati, modificati o di un editore diverso. Non inventeremo publisherName né disattiveremo i controlli. Le firme di test non sono firme pubblicamente attendibili. Per i vecchi client non firmati sarà documentata la prima installazione attendibile.

## Privacy e contatti

L’[informativa privacy](./privacy.md) descrive il consenso facoltativo a TalkingData. La firma non abilita le statistiche. Contatto: [84996057@qq.com](mailto:84996057@qq.com); non inviare chiavi private, password o token.

L’attribuzione a SignPath sarà aggiunta solo dopo approvazione e distribuzione realmente firmata, secondo le [condizioni della fondazione](https://signpath.org/terms).
