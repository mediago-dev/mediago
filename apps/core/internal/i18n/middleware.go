package i18n

import (
	"github.com/gin-gonic/gin"
	"golang.org/x/text/language"
)

const maxLanguageInputBytes = 64
const maxAcceptLanguageBytes = 256

// supported language tags for the matcher.
var (
	supported = []language.Tag{
		language.English,           // index 0, fallback
		language.SimplifiedChinese, // index 1
		language.Italian,           // index 2
		language.TraditionalChinese, // index 3
	}
	matcher        = language.NewMatcher(supported)
	supportedCodes = []string{"en", "zh", "it", "zh-TW"}
)

// Middleware resolves the request language and stores it in gin.Context.
//
// Resolution priority:
//  1. Query parameter ?lang=zh
//  2. Accept-Language header
//  3. Config store language setting (via getConfigLang callback)
//  4. Fallback to DefaultLang ("en")
func Middleware(getConfigLang func() string) gin.HandlerFunc {
	return func(c *gin.Context) {
		// 1. Query parameter
		if lang := c.Query("lang"); lang != "" && len(lang) <= maxLanguageInputBytes {
			c.Set(LangContextKey, resolveCode(lang))
			c.Next()
			return
		}

		// 2. Accept-Language header
		if accept := c.GetHeader("Accept-Language"); accept != "" && len(accept) <= maxAcceptLanguageBytes {
			tags, _, _ := language.ParseAcceptLanguage(accept)
			if len(tags) > 0 {
				_, index, _ := matcher.Match(tags...)
				c.Set(LangContextKey, supportedCodes[index])
				c.Next()
				return
			}
		}

		// 3. Config store
		if getConfigLang != nil {
			if configLang := getConfigLang(); configLang != "" {
				c.Set(LangContextKey, resolveCode(configLang))
				c.Next()
				return
			}
		}

		// 4. Fallback
		c.Set(LangContextKey, DefaultLang)
		c.Next()
	}
}

// resolveCode normalizes a language string to a supported catalog key.
func resolveCode(lang string) string {
	if len(lang) > maxLanguageInputBytes {
		return DefaultLang
	}
	tag, err := language.Parse(lang)
	if err != nil {
		return DefaultLang
	}
	_, index, _ := matcher.Match(tag)
	return supportedCodes[index]
}
