/**
 * Markdown 渲染：marked 解析 + highlight.js 代码高亮 + DOMPurify 消毒
 * ---------------------------------------------------------------------------
 * 说明：
 * 1. assistant 的输出属于不可信内容，必须先消毒再插入 DOM；
 * 2. 只按需注册常用语言（全量语言包约 1MB，gzip 后也有 300KB+）；
 * 3. 组件支持通过 `renderMarkdown` 选项整体替换掉这套实现。
 */
import DOMPurify from 'dompurify';
import type { Config as PurifyConfig } from 'dompurify';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import plaintext from 'highlight.js/lib/languages/plaintext';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { Marked, type RendererObject, type Tokens } from 'marked';

const LANGUAGES = {
  bash,
  cpp,
  csharp,
  css,
  diff,
  go,
  java,
  javascript,
  json,
  kotlin,
  markdown,
  php,
  plaintext,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml,
};

for (const [name, language] of Object.entries(LANGUAGES)) {
  hljs.registerLanguage(name, language);
}

hljs.registerAliases(['js', 'jsx', 'mjs', 'cjs', 'node'], { languageName: 'javascript' });
hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' });
hljs.registerAliases(['py'], { languageName: 'python' });
hljs.registerAliases(['html', 'vue', 'svg'], { languageName: 'xml' });
hljs.registerAliases(['yml'], { languageName: 'yaml' });
hljs.registerAliases(['sh', 'shell', 'zsh', 'console'], { languageName: 'bash' });
hljs.registerAliases(['cs'], { languageName: 'csharp' });
hljs.registerAliases(['md'], { languageName: 'markdown' });
hljs.registerAliases(['text', 'txt'], { languageName: 'plaintext' });

const LANGUAGE_ALIASES: Record<string, string> = {
  vue: 'xml',
  html: 'xml',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  yml: 'yaml',
  'c++': 'cpp',
  'c#': 'csharp',
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface HighlightResult {
  html: string;
  language: string;
}

/** 高亮单段代码；未标注或未知语言时返回转义后的纯文本 */
export function highlightCode(code: string, lang?: string): HighlightResult {
  const requested = (lang ?? '').trim().toLowerCase();
  const language = requested ? (LANGUAGE_ALIASES[requested] ?? requested) : '';

  if (language && hljs.getLanguage(language)) {
    try {
      return {
        html: hljs.highlight(code, { language, ignoreIllegals: true }).value,
        language,
      };
    } catch {
      /* 落到下面的自动识别 */
    }
  }

  if (!language) {
    try {
      const auto = hljs.highlightAuto(code);
      if (auto.relevance >= 5 && auto.language) {
        return { html: auto.value, language: auto.language };
      }
    } catch {
      /* 忽略：自动识别失败不影响渲染 */
    }
  }

  return { html: escapeHtml(code), language: language || 'text' };
}

const renderer: RendererObject = {
  code(this: unknown, tokenOrCode: unknown, legacyLang?: string) {
    const token = (
      tokenOrCode && typeof tokenOrCode === 'object'
        ? tokenOrCode
        : { text: tokenOrCode, lang: legacyLang }
    ) as Tokens.Code;

    const rawCode = typeof token.text === 'string' ? token.text : String(token.text ?? '');
    const { html, language } = highlightCode(
      rawCode,
      typeof token.lang === 'string' ? token.lang : '',
    );

    return [
      `<div class="code-block" data-language="${escapeHtml(language)}">`,
      `<div class="code-block__bar">`,
      `<span class="code-block__lang">${escapeHtml(language)}</span>`,
      `<button type="button" class="code-copy-btn" data-code-copy>复制</button>`,
      `</div>`,
      `<pre class="code-block__pre"><code class="hljs language-${escapeHtml(language)}">${html}</code></pre>`,
      `</div>`,
    ].join('');
  },

  link(this: unknown, tokenOrHref: unknown, legacyText?: string, legacyTitle?: string | null) {
    const token = (
      tokenOrHref && typeof tokenOrHref === 'object'
        ? tokenOrHref
        : { href: tokenOrHref, text: legacyText, title: legacyTitle }
    ) as Tokens.Link;

    const titleAttr = token.title ? ` title="${escapeHtml(token.title)}"` : '';
    return `<a href="${escapeHtml(token.href ?? '#')}"${titleAttr} target="_blank" rel="noopener noreferrer nofollow">${token.text ?? ''}</a>`;
  },

  image(this: unknown, tokenOrHref: unknown, legacyTitle?: string | null, legacyText?: string) {
    const token = (
      tokenOrHref && typeof tokenOrHref === 'object'
        ? tokenOrHref
        : { href: tokenOrHref, title: legacyTitle, text: legacyText }
    ) as Tokens.Image;

    const alt = escapeHtml(token.text ?? '');
    const titleAttr = token.title ? ` title="${escapeHtml(token.title)}"` : '';
    return `<img src="${escapeHtml(token.href ?? '')}" alt="${alt}"${titleAttr} loading="lazy" class="markdown-img" />`;
  },
};

const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer,
});

const PURIFY_CONFIG: PurifyConfig = {
  ADD_ATTR: ['target', 'rel', 'data-code-copy', 'data-language', 'loading'],
  ADD_TAGS: ['button'],
  FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'object', 'embed', 'script'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'style'],
};

/** Markdown -> 安全的 HTML 字符串 */
export function renderMarkdown(source: string): string {
  if (!source) return '';

  let rawHtml: string;
  try {
    rawHtml = marked.parse(source, { async: false }) as string;
  } catch (error) {
    console.warn('[glintchat] Markdown 解析失败，降级为纯文本：', error);
    return `<p>${escapeHtml(source).replace(/\n/g, '<br />')}</p>`;
  }

  try {
    // 显式标注返回类型，避免命中 RETURN_TRUSTED_TYPE 的重载（返回 TrustedHTML）
    const clean: string = DOMPurify.sanitize(rawHtml, PURIFY_CONFIG);
    return clean;
  } catch (error) {
    console.warn('[glintchat] Markdown 消毒失败，降级为纯文本：', error);
    return `<p>${escapeHtml(source)}</p>`;
  }
}
