/* global PDFLib, fontkit */

(function () {
  const DEFAULT_URLS = {
    textRegular:
      "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf",
    textBold:
      "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Bold.ttf",
    symbols:
      "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSansSymbols2/NotoSansSymbols2-Regular.ttf",
    emoji:
      "https://raw.githubusercontent.com/googlefonts/noto-emoji/main/fonts/NotoEmoji-Regular.ttf",
  };

  const bytesCache = new Map();
  async function fetchFontBytes(url) {
    if (!url) return null;
    if (!bytesCache.has(url)) {
      bytesCache.set(
        url,
        fetch(url, { cache: "force-cache" }).then((res) => {
          if (!res.ok) throw new Error(`Font fetch failed: ${res.status} ${url}`);
          return res.arrayBuffer();
        })
      );
    }
    return await bytesCache.get(url);
  }

  const graphemeSegmenter =
    typeof Intl !== "undefined" && Intl.Segmenter
      ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
      : null;
  function splitGraphemes(text) {
    const str = String(text || "");
    if (!graphemeSegmenter) return Array.from(str);
    return Array.from(graphemeSegmenter.segment(str), (s) => s.segment);
  }

  function isEmojiGrapheme(grapheme) {
    try {
      return /\p{Extended_Pictographic}/u.test(grapheme);
    } catch {
      // Fallback: rough emoji range check (not exhaustive).
      return /[\u{1F300}-\u{1FAFF}]/u.test(grapheme);
    }
  }

  function isSymbolGrapheme(grapheme) {
    try {
      return /\p{Symbol}/u.test(grapheme);
    } catch {
      return false;
    }
  }

  function getFontForGrapheme(grapheme, fonts, bold) {
    const textFont = (bold ? fonts.textBold : fonts.text) || fonts.text || fonts.textBold;
    if (!textFont) return null;

    if (isEmojiGrapheme(grapheme) && fonts.emoji) return fonts.emoji;
    if (isSymbolGrapheme(grapheme) && fonts.symbols) return fonts.symbols;
    return textFont;
  }

  function segmentToRuns(text, fonts, bold) {
    const graphemes = splitGraphemes(text);
    const runs = [];
    for (const g of graphemes) {
      const font = getFontForGrapheme(g, fonts, bold);
      if (!runs.length || runs[runs.length - 1].font !== font) {
        runs.push({ text: g, font });
      } else {
        runs[runs.length - 1].text += g;
      }
    }
    return runs;
  }

  function safeWidthOfText(run, size, fallbackFont) {
    if (!run?.font) return 0;
    try {
      return run.font.widthOfTextAtSize(run.text, size);
    } catch {
      if (fallbackFont) {
        try {
          return fallbackFont.widthOfTextAtSize(run.text, size);
        } catch {}
      }
      return 0;
    }
  }

  function measureRuns(runs, size, fallbackFont) {
    return runs.reduce((sum, r) => sum + safeWidthOfText(r, size, fallbackFont), 0);
  }

  function pushLine(lines, lineRuns) {
    const compact = [];
    for (const r of lineRuns) {
      if (!r.text) continue;
      const prev = compact[compact.length - 1];
      if (prev && prev.font === r.font) prev.text += r.text;
      else compact.push(r);
    }
    lines.push(compact);
  }

  function wrapText(text, fonts, size, maxWidth, { bold = false } = {}) {
    const str = String(text || "");
    const lines = [];

    const fallbackFont = fonts.text || fonts.textBold || null;
    const paragraphs = str.split("\n");

    for (let p = 0; p < paragraphs.length; p++) {
      const paragraph = paragraphs[p];
      const tokens = paragraph.split(/([ \t]+)/).filter(Boolean);

      let lineRuns = [];
      let lineWidth = 0;

      for (const token of tokens) {
        const isWhitespace = /^[ \t]+$/.test(token);
        if (!lineRuns.length && isWhitespace) continue;

        const tokenRuns = segmentToRuns(token, fonts, bold);
        const tokenWidth = measureRuns(tokenRuns, size, fallbackFont);

        if (!lineRuns.length) {
          if (tokenWidth <= maxWidth) {
            lineRuns.push(...tokenRuns);
            lineWidth = tokenWidth;
            continue;
          }
          // Token too wide: break by grapheme.
        } else if (lineWidth + tokenWidth <= maxWidth) {
          lineRuns.push(...tokenRuns);
          lineWidth += tokenWidth;
          continue;
        }

        // If we got here: push current line, start a new one (trim leading whitespace).
        if (lineRuns.length) pushLine(lines, lineRuns);
        lineRuns = [];
        lineWidth = 0;

        if (isWhitespace) continue;

        // Break long token into multiple lines by grapheme.
        const graphemes = splitGraphemes(token);
        for (const g of graphemes) {
          const gRuns = segmentToRuns(g, fonts, bold);
          const gWidth = measureRuns(gRuns, size, fallbackFont);
          if (lineRuns.length && lineWidth + gWidth > maxWidth) {
            pushLine(lines, lineRuns);
            lineRuns = [];
            lineWidth = 0;
          }
          lineRuns.push(...gRuns);
          lineWidth += gWidth;
        }
      }

      if (lineRuns.length) pushLine(lines, lineRuns);
      else lines.push([]);

      if (p < paragraphs.length - 1) {
        // Newline: start next paragraph on a fresh line (no extra blank line).
      }
    }

    // Remove trailing empty lines created by empty last paragraph.
    while (lines.length && lines[lines.length - 1].length === 0) lines.pop();
    return lines;
  }

  function drawRunsLine(page, runs, { x, y, size, color } = {}) {
    let cursorX = x || 0;
    for (const run of runs || []) {
      if (!run?.text) continue;
      page.drawText(run.text, {
        x: cursorX,
        y,
        size,
        font: run.font,
        color,
      });
      cursorX += safeWidthOfText(run, size);
    }
    return cursorX;
  }

  async function ensureFonts(pdfDoc, urls = {}) {
    const { StandardFonts } = PDFLib;
    const merged = { ...DEFAULT_URLS, ...urls };

    // Always have a safe fallback.
    const fallbackText = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fallbackBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    if (typeof pdfDoc.registerFontkit === "function" && typeof fontkit !== "undefined") {
      try {
        pdfDoc.registerFontkit(fontkit);
      } catch {}
    }

    async function tryEmbed(url) {
      try {
        const bytes = await fetchFontBytes(url);
        if (!bytes) return null;
        return await pdfDoc.embedFont(bytes, { subset: true });
      } catch {
        return null;
      }
    }

    const [text, textBold, symbols, emoji] = await Promise.all([
      tryEmbed(merged.textRegular),
      tryEmbed(merged.textBold),
      tryEmbed(merged.symbols),
      tryEmbed(merged.emoji),
    ]);

    return {
      text: text || fallbackText,
      textBold: textBold || fallbackBold,
      symbols: symbols || null,
      emoji: emoji || null,
    };
  }

  window.PDFUnicode = {
    ensureFonts,
    wrapText,
    segmentToRuns,
    drawRunsLine,
  };
})();

