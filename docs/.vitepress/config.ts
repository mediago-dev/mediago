import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type HeadConfig } from "vitepress";
import { baiduAnalytics, googleAnalytics } from "./plugins";

const isDev = process.env.NODE_ENV === "development";
const siteUrl = "https://downloader.caorushizi.cn";

const head: HeadConfig[] = [
  ["link", { rel: "shortcut icon", href: "/favicon.svg" }],
];
if (!isDev) {
  head.push(...baiduAnalytics(), ...googleAnalytics());
}

const translatedBlogAlternates: Record<string, Record<string, string>> = {
  "blog/video-downloader-review/index": {
    "zh-CN": `${siteUrl}/blog/video-downloader-review/`,
    en: `${siteUrl}/en/blog/video-downloader-review/`,
    "x-default": `${siteUrl}/blog/video-downloader-review/`,
  },
  "en/blog/video-downloader-review/index": {
    "zh-CN": `${siteUrl}/blog/video-downloader-review/`,
    en: `${siteUrl}/en/blog/video-downloader-review/`,
    "x-default": `${siteUrl}/blog/video-downloader-review/`,
  },
};

function getPageUrl(page: string) {
  const normalized = page.replace(/\.md$/, "");
  if (normalized === "index") {
    return `${siteUrl}/`;
  }
  if (normalized.endsWith("/index")) {
    return `${siteUrl}/${normalized.slice(0, -"/index".length)}/`;
  }
  return `${siteUrl}/${normalized}.html`;
}

function getPageLanguage(page: string) {
  if (page.startsWith("en/")) {
    return "en";
  }
  if (page.startsWith("jp/")) {
    return "ja";
  }
  if (page.startsWith("it/")) {
    return "it";
  }
  return "zh-CN";
}

function isBlogPagePath(page: string) {
  return page.startsWith("blog/") || /^[a-z]{2}\/blog\//.test(page);
}

function isBlogIndexPage(page: string) {
  return page === "blog/index.md" || /^[a-z]{2}\/blog\/index\.md$/.test(page);
}

function getAbsoluteUrl(url: string) {
  if (/^https?:\/\//.test(url)) {
    return url;
  }
  return `${siteUrl}${url.startsWith("/") ? "" : "/"}${url}`;
}

function getStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function getBreadcrumbItems(
  pageUrl: string,
  pageTitle: string,
  isBlogPage: boolean,
  language: string,
) {
  const isEnglish = language === "en";
  const localePrefix = isEnglish ? "/en" : "";
  const items = [
    {
      "@type": "ListItem",
      position: 1,
      name: isEnglish ? "Home" : "首页",
      item: `${siteUrl}${localePrefix}/`,
    },
  ];

  if (isBlogPage) {
    items.push({
      "@type": "ListItem",
      position: 2,
      name: isEnglish ? "Blog" : "博客",
      item: `${siteUrl}${localePrefix}/blog/`,
    });

    if (pageUrl !== `${siteUrl}${localePrefix}/blog/`) {
      items.push({
        "@type": "ListItem",
        position: 3,
        name: pageTitle,
        item: pageUrl,
      });
    }
  }

  return items;
}

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "MediaGo",
  description: "简单易用，快速下载",
  lastUpdated: true,
  head,
  srcExclude: ["superpowers/**"],
  sitemap: {
    hostname: siteUrl,
  },
  transformHead({ page, pageData, title, description }) {
    const normalizedPage = page.replace(/\.md$/, "");
    const pageUrl = getPageUrl(page);
    const frontmatter = pageData.frontmatter;
    const language = getPageLanguage(page);
    const isBlogPage = isBlogPagePath(page);
    const pageTitle = String(frontmatter.title || title || "MediaGo");
    const pageDescription = String(
      frontmatter.description || description || "简单易用，快速下载",
    );
    const pageTags = getStringArray(frontmatter.tags);
    const pageImage =
      typeof frontmatter.image === "string"
        ? getAbsoluteUrl(frontmatter.image)
        : undefined;
    const entries: HeadConfig[] = [
      ["link", { rel: "canonical", href: pageUrl }],
      ["meta", { property: "og:url", content: pageUrl }],
      ["meta", { property: "og:title", content: pageTitle }],
      ["meta", { property: "og:description", content: pageDescription }],
      ["meta", { property: "og:site_name", content: "MediaGo" }],
      [
        "meta",
        { property: "og:type", content: isBlogPage ? "article" : "website" },
      ],
      ["meta", { name: "twitter:card", content: "summary_large_image" }],
      ["meta", { name: "twitter:title", content: pageTitle }],
      ["meta", { name: "twitter:description", content: pageDescription }],
      [
        "script",
        { type: "application/ld+json" },
        JSON.stringify({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: getBreadcrumbItems(
            pageUrl,
            pageTitle,
            isBlogPage,
            language,
          ),
        }),
      ],
    ];

    const alternates = translatedBlogAlternates[normalizedPage];
    if (alternates) {
      for (const [hreflang, href] of Object.entries(alternates)) {
        entries.push(["link", { rel: "alternate", hreflang, href }]);
      }
    }

    if (pageTags.length > 0) {
      entries.push(["meta", { name: "keywords", content: pageTags.join(",") }]);
    }

    if (pageImage) {
      entries.push(
        ["meta", { property: "og:image", content: pageImage }],
        ["meta", { name: "twitter:image", content: pageImage }],
      );
    }

    if (isBlogPage && !isBlogIndexPage(page)) {
      const article: Record<string, unknown> = {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        headline: pageTitle,
        description: pageDescription,
        author: {
          "@type": "Organization",
          name: String(frontmatter.author || "MediaGo"),
          url: siteUrl,
        },
        publisher: {
          "@type": "Organization",
          name: "MediaGo",
          url: siteUrl,
        },
        datePublished: frontmatter.date,
        dateModified: frontmatter.updated || frontmatter.date,
        mainEntityOfPage: pageUrl,
        inLanguage: language,
      };

      if (pageTags.length > 0) {
        article.keywords = pageTags;
      }

      if (pageImage) {
        article.image = [pageImage];
      }

      entries.push([
        "script",
        { type: "application/ld+json" },
        JSON.stringify(article),
      ]);

      if (frontmatter.date) {
        entries.push([
          "meta",
          {
            property: "article:published_time",
            content: String(frontmatter.date),
          },
        ]);
      }

      if (frontmatter.updated || frontmatter.date) {
        entries.push([
          "meta",
          {
            property: "article:modified_time",
            content: String(frontmatter.updated || frontmatter.date),
          },
        ]);
      }

      for (const tag of pageTags) {
        entries.push(["meta", { property: "article:tag", content: tag }]);
      }
    }

    return entries;
  },
  themeConfig: {
    nav: [
      { text: "Home", link: "/" },
      { text: "教程", link: "/guides" },
      { text: "更新日志", link: "/changelog" },
    ],

    sidebar: {
      "/blog/": [
        {
          text: "博客",
          items: [
            { text: "博客首页", link: "/blog/" },
            {
              text: "视频下载器推荐",
              link: "/blog/video-downloader-recommendation/",
            },
            { text: "视频下载器评测", link: "/blog/video-downloader-review/" },
            { text: "网页视频下载指南", link: "/blog/video-download/" },
            { text: "M3U8 / HLS 下载指南", link: "/blog/m3u8-hls-download/" },
            { text: "网页视频嗅探指南", link: "/blog/video-sniffer/" },
          ],
        },
        {
          text: "产品文档",
          items: [
            { text: "快速开始", link: "/guides" },
            { text: "使用说明", link: "/documents" },
            { text: "浏览器扩展", link: "/extension" },
            { text: "下载接口", link: "/api" },
          ],
        },
      ],
      "/": [
        {
          text: "开始",
          items: [
            { text: "快速开始", link: "/guides" },
            { text: "使用说明", link: "/documents" },
            { text: "下载接口", link: "/api" },
            { text: "更新日志", link: "/changelog" },
            { text: "通过宝塔面板部署", link: "/bt-install" },
            { text: "浏览器扩展", link: "/extension" },
            { text: "配合猫爪下载视频", link: "/catcatch" },
            { text: "🦞 OpenClaw Skill", link: "/skills" },
          ],
        },
        {
          text: "Q&A",
          items: [
            { text: "常见问题", link: "/qa" },
            { text: "windows7支持（64位）", link: "/history" },
            { text: "意见收集", link: "/proposal" },
            { text: "支持列表", link: "/list" },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/caorushizi/m3u8-downloader" },
    ],
  },

  locales: {
    root: {
      label: "简体中文",
      lang: "zh",
    },
    en: {
      label: "English",
      lang: "en",
      themeConfig: {
        nav: [
          { text: "Home", link: "/en" },
          { text: "Guides", link: "/en/guides" },
          { text: "Blog", link: "/en/blog/" },
          { text: "Changelog", link: "/en/changelog" },
        ],

        sidebar: {
          "/en/blog/": [
            {
              text: "Blog",
              items: [
                { text: "Blog Home", link: "/en/blog/" },
                {
                  text: "Video Downloader Review",
                  link: "/en/blog/video-downloader-review/",
                },
              ],
            },
            {
              text: "Product Docs",
              items: [
                { text: "Quick Start", link: "/en/guides" },
                { text: "User Guide", link: "/en/documents" },
                { text: "Browser Extension", link: "/en/extension" },
                { text: "Download API", link: "/en/api" },
              ],
            },
          ],
          "/en/": [
            {
              text: "Quick start",
              items: [
                { text: "Quick start", link: "/en/guides" },
                { text: "Baota Panel", link: "/en/bt-install" },
                { text: "Documents", link: "/en/documents" },
                { text: "Download API", link: "/en/api" },
                { text: "Changelog", link: "/en/changelog" },
                { text: "Browser extension", link: "/en/extension" },
                { text: "🦞 OpenClaw Skill", link: "/en/skills" },
              ],
            },
            {
              text: "Q&A",
              items: [
                { text: "History", link: "/en/history" },
                { text: "Proposal", link: "/en/proposal" },
                { text: "Support list", link: "/en/list" },
              ],
            },
          ],
        },

        socialLinks: [
          {
            icon: "github",
            link: "https://github.com/caorushizi/mediago",
          },
        ],
      },
    },
    jp: {
      label: "日本語",
      lang: "jp",
      themeConfig: {
        nav: [
          { text: "Home", link: "/jp" },
          { text: "です", link: "/jp/guides" },
          { text: "ログを更新します。", link: "/jp/changelog" },
        ],

        sidebar: [
          {
            text: "始める",
            items: [
              { text: "早く始めます", link: "/jp/guides" },
              { text: "塔のパネル配置です", link: "/jp/bt-install" },
              { text: "使用説明書です", link: "/jp/documents" },
              { text: "ダウンロード API", link: "/jp/api" },
              { text: "ログを更新します。", link: "/jp/changelog" },
              { text: "ブラウザ拡張機能", link: "/jp/extension" },
              { text: "🦞 OpenClaw Skill", link: "/jp/skills" },
            ],
          },
          {
            text: "Q&A",
            items: [
              { text: "古いバージョンです", link: "/jp/history" },
              { text: "意見収集です", link: "/jp/proposal" },
              { text: "サポートリストです", link: "/jp/list" },
            ],
          },
        ],

        socialLinks: [
          {
            icon: "github",
            link: "https://github.com/caorushizi/mediago",
          },
        ],
      },
    },
    it: {
      label: "Italiano",
      lang: "it",
      themeConfig: {
        nav: [
          { text: "Home", link: "/it" },
          { text: "Guide", link: "/it/guides" },
          { text: "Changelog", link: "/it/changelog" },
        ],

        sidebar: [
          {
            text: "Avvio rapido",
            items: [
              { text: "Avvio rapido", link: "/it/guides" },
              { text: "BT Panel", link: "/it/bt-install" },
              { text: "Guida utente", link: "/it/documents" },
              { text: "API di download", link: "/it/api" },
              { text: "Changelog", link: "/it/changelog" },
              { text: "Estensione browser", link: "/it/extension" },
              { text: "🦞 OpenClaw Skill", link: "/it/skills" },
            ],
          },
          {
            text: "Q&A",
            items: [
              { text: "Versioni precedenti", link: "/it/history" },
              { text: "Feedback", link: "/it/proposal" },
              { text: "Siti supportati", link: "/it/list" },
            ],
          },
        ],

        socialLinks: [
          {
            icon: "github",
            link: "https://github.com/caorushizi/mediago",
          },
        ],
      },
    },
  },

  vite: {
    plugins: [tailwindcss()],
  },
});
