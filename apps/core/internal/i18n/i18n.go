package i18n

import (
	"fmt"

	"github.com/gin-gonic/gin"
)

// LangContextKey is the gin.Context key for the resolved language.
const LangContextKey = "i18n.lang"

// DefaultLang is the fallback language when none is resolved.
const DefaultLang = "en"

// catalogs maps language codes to translation maps.
var catalogs = map[string]map[string]string{
	"en": {
		// Common
		MsgOK:                  "OK",
		MsgDeleted:             "Deleted",
		MsgImported:            "Imported",
		MsgInvalidID:           "invalid id",
		MsgInvalidRequest:      "Invalid request",
		MsgInternalError:       "An internal error occurred",
		MsgSourcesCountInvalid: "sources must contain between 1 and 20 items",

		MsgDiscoveryNotFound:             "discovery not found",
		MsgDiscoveryInvalidURL:           "discovery URL must use HTTP or HTTPS",
		MsgDiscoveryInvalidMode:          "invalid discovery mode",
		MsgDiscoveryInvalidInspectURL:    "inspect mode requires a direct M3U8 URL",
		MsgDiscoveryExecutorUnavailable:  "browser discovery executor unavailable",
		MsgDiscoveryInspectorUnavailable: "HLS inspector unavailable",
		MsgDiscoveryQueueFull:            "discovery queue is full",
		MsgDiscoveryInvalidState:         "invalid discovery state",
		MsgDiscoverySourceNotFound:       "discovery source not found",
		MsgDiscoveryDownloadUnavailable:  "download persistence is unavailable",

		// Auth
		MsgUnauthorized:     "unauthorized",
		MsgAPIKeyRequired:   "apiKey is required",
		MsgAPIKeyAlreadySet: "apiKey is already configured",
		MsgInvalidAPIKey:    "invalid apiKey",

		MsgAuthSetupTokenInvalid: "initialization code is missing or invalid",
		MsgAuthSetupUnavailable:  "initialization code is unavailable; contact the server administrator",
		MsgAuthRateLimited:       "too many authentication attempts; try again later",

		// Task
		MsgTaskCreated:          "Task created successfully",
		MsgTaskEnqueued:         "Task enqueued successfully",
		MsgTaskNotFound:         "task not found",
		MsgTaskStopped:          "Task stopped",
		MsgTaskLogNotConfigured: "task log storage not configured",
		MsgTaskLogNotFound:      "task log not found",
		MsgTaskLogReadFailed:    "failed to read task log",

		// Download
		MsgDownloadStarted: "Download started",
		MsgDownloadStopped: "Download stopped",
		MsgStatusUpdated:   "Status updated",

		// Config
		MsgConfigUpdated:    "Config updated",
		MsgConfigKeyUpdated: "Config key '%s' updated",

		// Util
		MsgURLRequired: "url parameter is required",

		// Favorite
		MsgURLAlreadyExists: "URL already exists",
		MsgFavoriteNotFound: "favorite with id %d not found",

		// Event
		MsgEventStreamFailed: "Failed to create event stream",

		// Core
		MsgUnsupportedType: "unsupported download type",
		MsgBinNotFound:     "binary not found for type",

		// DB
		MsgVideoNotFound:      "video with id %d not found",
		MsgConversionNotFound: "conversion with id %d not found",
	},
	"zh": {
		// Common
		MsgOK:                  "操作成功",
		MsgDeleted:             "已删除",
		MsgImported:            "已导入",
		MsgInvalidID:           "无效 ID",
		MsgInvalidRequest:      "请求参数无效",
		MsgInternalError:       "发生内部错误",
		MsgSourcesCountInvalid: "来源数量必须在 1 到 20 个之间",

		MsgDiscoveryNotFound:             "未找到素材发现任务",
		MsgDiscoveryInvalidURL:           "素材发现 URL 必须使用 HTTP 或 HTTPS",
		MsgDiscoveryInvalidMode:          "无效的素材发现模式",
		MsgDiscoveryInvalidInspectURL:    "检查模式需要直接的 M3U8 URL",
		MsgDiscoveryExecutorUnavailable:  "浏览器素材发现执行器不可用",
		MsgDiscoveryInspectorUnavailable: "HLS 检查器不可用",
		MsgDiscoveryQueueFull:            "素材发现队列已满",
		MsgDiscoveryInvalidState:         "素材发现任务状态无效",
		MsgDiscoverySourceNotFound:       "未找到素材来源",
		MsgDiscoveryDownloadUnavailable:  "下载持久化服务不可用",

		// Auth
		MsgUnauthorized:     "未授权",
		MsgAPIKeyRequired:   "请提供 apiKey",
		MsgAPIKeyAlreadySet: "apiKey 已配置",
		MsgInvalidAPIKey:    "apiKey 无效",

		MsgAuthSetupTokenInvalid: "初始化校验码缺失或无效",
		MsgAuthSetupUnavailable:  "初始化校验码不可用，请联系服务器管理员",
		MsgAuthRateLimited:       "认证请求过于频繁，请稍后重试",

		// Task
		MsgTaskCreated:          "任务创建成功",
		MsgTaskEnqueued:         "任务已加入队列",
		MsgTaskNotFound:         "任务未找到",
		MsgTaskStopped:          "任务已停止",
		MsgTaskLogNotConfigured: "任务日志存储未配置",
		MsgTaskLogNotFound:      "任务日志未找到",
		MsgTaskLogReadFailed:    "读取任务日志失败",

		// Download
		MsgDownloadStarted: "下载已开始",
		MsgDownloadStopped: "下载已停止",
		MsgStatusUpdated:   "状态已更新",

		// Config
		MsgConfigUpdated:    "配置已更新",
		MsgConfigKeyUpdated: "配置键 '%s' 已更新",

		// Util
		MsgURLRequired: "缺少 url 参数",

		// Favorite
		MsgURLAlreadyExists: "URL 已存在",
		MsgFavoriteNotFound: "未找到 ID 为 %d 的收藏",

		// Event
		MsgEventStreamFailed: "创建事件流失败",

		// Core
		MsgUnsupportedType: "不支持的下载类型",
		MsgBinNotFound:     "未找到对应类型的可执行文件",

		// DB
		MsgVideoNotFound:      "未找到 ID 为 %d 的视频",
		MsgConversionNotFound: "未找到 ID 为 %d 的转换记录",
	},
	"zh-TW": {
		// Common
		MsgOK:                  "操作成功",
		MsgDeleted:             "已刪除",
		MsgImported:            "已匯入",
		MsgInvalidID:           "無效 ID",
		MsgInvalidRequest:      "請求引數無效",
		MsgInternalError:       "發生內部錯誤",
		MsgSourcesCountInvalid: "來源數量必須在 1 到 20 個之間",

		MsgDiscoveryNotFound:             "未找到素材發現任務",
		MsgDiscoveryInvalidURL:           "素材發現 URL 必須使用 HTTP 或 HTTPS",
		MsgDiscoveryInvalidMode:          "無效的素材發現模式",
		MsgDiscoveryInvalidInspectURL:    "檢查模式需要直接的 M3U8 URL",
		MsgDiscoveryExecutorUnavailable:  "瀏覽器素材發現執行器不可用",
		MsgDiscoveryInspectorUnavailable: "HLS 檢查器不可用",
		MsgDiscoveryQueueFull:            "素材發現佇列已滿",
		MsgDiscoveryInvalidState:         "素材發現任務狀態無效",
		MsgDiscoverySourceNotFound:       "未找到素材來源",
		MsgDiscoveryDownloadUnavailable:  "下載持久化服務不可用",

		// Auth
		MsgUnauthorized:     "未授權",
		MsgAPIKeyRequired:   "請提供 apiKey",
		MsgAPIKeyAlreadySet: "apiKey 已設定",
		MsgInvalidAPIKey:    "apiKey 無效",

		MsgAuthSetupTokenInvalid: "初始化校驗碼缺失或無效",
		MsgAuthSetupUnavailable:  "初始化校驗碼不可用，請聯絡伺服器管理員",
		MsgAuthRateLimited:       "認證請求過於頻繁，請稍後重試",

		// Task
		MsgTaskCreated:          "任務建立成功",
		MsgTaskEnqueued:         "任務已加入佇列",
		MsgTaskNotFound:         "任務未找到",
		MsgTaskStopped:          "任務已停止",
		MsgTaskLogNotConfigured: "任務日誌儲存未設定",
		MsgTaskLogNotFound:      "任務日誌未找到",
		MsgTaskLogReadFailed:    "讀取任務日誌失敗",

		// Download
		MsgDownloadStarted: "下載已開始",
		MsgDownloadStopped: "下載已停止",
		MsgStatusUpdated:   "狀態已更新",

		// Config
		MsgConfigUpdated:    "設定已更新",
		MsgConfigKeyUpdated: "設定鍵 '%s' 已更新",

		// Util
		MsgURLRequired: "缺少 url 引數",

		// Favorite
		MsgURLAlreadyExists: "URL 已存在",
		MsgFavoriteNotFound: "未找到 ID 為 %d 的收藏",

		// Event
		MsgEventStreamFailed: "建立事件流失敗",

		// Core
		MsgUnsupportedType: "不支援的下載類型",
		MsgBinNotFound:     "未找到對應類型的可執行檔案",

		// DB
		MsgVideoNotFound:      "未找到 ID 為 %d 的影片",
		MsgConversionNotFound: "未找到 ID 為 %d 的轉換記錄",
	},
	"it": {
		// Common
		MsgOK:                  "Operazione riuscita",
		MsgDeleted:             "Eliminato",
		MsgImported:            "Importato",
		MsgInvalidID:           "ID non valido",
		MsgInvalidRequest:      "Richiesta non valida",
		MsgInternalError:       "Si è verificato un errore interno",
		MsgSourcesCountInvalid: "Le sorgenti devono essere da 1 a 20",

		MsgDiscoveryNotFound:             "Rilevamento multimediale non trovato",
		MsgDiscoveryInvalidURL:           "L'URL deve usare HTTP o HTTPS",
		MsgDiscoveryInvalidMode:          "Modalità di rilevamento non valida",
		MsgDiscoveryInvalidInspectURL:    "La modalità inspect richiede un URL M3U8 diretto",
		MsgDiscoveryExecutorUnavailable:  "Esecutore browser non disponibile",
		MsgDiscoveryInspectorUnavailable: "Inspector HLS non disponibile",
		MsgDiscoveryQueueFull:            "Coda di rilevamento piena",
		MsgDiscoveryInvalidState:         "Stato del rilevamento non valido",
		MsgDiscoverySourceNotFound:       "Sorgente multimediale non trovata",
		MsgDiscoveryDownloadUnavailable:  "Persistenza download non disponibile",

		// Auth
		MsgUnauthorized:     "Non autorizzato",
		MsgAPIKeyRequired:   "apiKey è obbligatoria",
		MsgAPIKeyAlreadySet: "apiKey è già configurata",
		MsgInvalidAPIKey:    "apiKey non valida",

		MsgAuthSetupTokenInvalid: "codice di inizializzazione mancante o non valido",
		MsgAuthSetupUnavailable:  "codice di inizializzazione non disponibile; contatta l’amministratore",
		MsgAuthRateLimited:       "troppi tentativi di autenticazione; riprova più tardi",

		// Task
		MsgTaskCreated:          "Attività creata correttamente",
		MsgTaskEnqueued:         "Attività aggiunta alla coda",
		MsgTaskNotFound:         "Attività non trovata",
		MsgTaskStopped:          "Attività interrotta",
		MsgTaskLogNotConfigured: "Archiviazione dei log non configurata",
		MsgTaskLogNotFound:      "Log dell'attività non trovato",
		MsgTaskLogReadFailed:    "Impossibile leggere il log dell'attività",

		// Download
		MsgDownloadStarted: "Download avviato",
		MsgDownloadStopped: "Download interrotto",
		MsgStatusUpdated:   "Stato aggiornato",

		// Config
		MsgConfigUpdated:    "Configurazione aggiornata",
		MsgConfigKeyUpdated: "Chiave di configurazione '%s' aggiornata",

		// Util
		MsgURLRequired: "Il parametro url è obbligatorio",

		// Favorite
		MsgURLAlreadyExists: "L'URL esiste già",
		MsgFavoriteNotFound: "Preferito con ID %d non trovato",

		// Event
		MsgEventStreamFailed: "Impossibile creare il flusso di eventi",

		// Core
		MsgUnsupportedType: "Tipo di download non supportato",
		MsgBinNotFound:     "File eseguibile non trovato per questo tipo",

		// DB
		MsgVideoNotFound:      "Video con ID %d non trovato",
		MsgConversionNotFound: "Conversione con ID %d non trovata",
	},
}

// T translates a message key using the language stored in gin.Context.
// Optional args are passed to fmt.Sprintf if the translated template contains placeholders.
func T(c *gin.Context, key string, args ...any) string {
	lang := Lang(c)
	return TLang(lang, key, args...)
}

// TLang translates a message key for the given language string.
func TLang(lang, key string, args ...any) string {
	catalog, ok := catalogs[lang]
	if !ok {
		catalog = catalogs[DefaultLang]
	}

	msg, ok := catalog[key]
	if !ok {
		// Fall back to English, then to raw key
		if enMsg, ok := catalogs[DefaultLang][key]; ok {
			msg = enMsg
		} else {
			msg = key
		}
	}

	if len(args) > 0 {
		return fmt.Sprintf(msg, args...)
	}
	return msg
}

// Lang returns the resolved language string from gin.Context.
func Lang(c *gin.Context) string {
	if v, exists := c.Get(LangContextKey); exists {
		if lang, ok := v.(string); ok && lang != "" {
			return lang
		}
	}
	return DefaultLang
}

// SupportedLanguages returns all supported language codes.
func SupportedLanguages() []string {
	langs := make([]string, 0, len(catalogs))
	for k := range catalogs {
		langs = append(langs, k)
	}
	return langs
}
