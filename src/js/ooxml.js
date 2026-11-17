'use strict';

// Leitura e escrita de ficheiros do Word (.docx), Excel (.xlsx) e PowerPoint (.pptx).
// Estes formatos são arquivos ZIP com XML lá dentro; a conversão cobre o conteúdo e a formatação
// mais comuns (ver o README para os limites).
(function () {
  const MO = (window.MO = window.MO || {});
  const zipLib = window.fflate;
  const F = MO.Formula;

  const MAX_ENTRY = 40 * 1024 * 1024; // maior ficheiro aceite dentro do arquivo
  const MAX_TOTAL = 150 * 1024 * 1024; // total descomprimido aceite (proteção contra "zip bombs")
  const EMU = 9525; // EMU por píxel a 96 ppp
  const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' };
  const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  // ---------- Utilitários ----------

  function unzip(bytes) {
    let total = 0;
    return zipLib.unzipSync(bytes, {
      filter(file) {
        if (file.originalSize > MAX_ENTRY) return false;
        total += file.originalSize;
        if (total > MAX_TOTAL) throw new Error('Arquivo demasiado grande');
        return true;
      }
    });
  }

  function zip(parts) {
    const out = {};
    for (const [name, data] of Object.entries(parts)) out[name] = typeof data === 'string' ? encoder.encode(data) : data;
    return zipLib.zipSync(out, { level: 6 });
  }

  function parseXML(files, name) {
    if (!files[name]) return null;
    const doc = new DOMParser().parseFromString(decoder.decode(files[name]), 'application/xml');
    return doc.getElementsByTagName('parsererror').length ? null : doc;
  }

  // Os prefixos dos espaços de nomes variam entre programas; procura-se sempre pelo nome local.
  const all = (node, name) => (node ? [...node.getElementsByTagNameNS('*', name)] : []);
  const first = (node, name) => (node ? node.getElementsByTagNameNS('*', name)[0] || null : null);
  const kids = (node, name) => (node ? [...node.children].filter((c) => !name || c.localName === name) : []);
  const kid = (node, name) => kids(node, name)[0] || null;
  function attr(node, name) {
    if (!node) return null;
    for (const a of node.attributes) if (a.localName === name) return a.value;
    return null;
  }

  // r:id — o identificador de relação, que não se confunde com um atributo "id" sem prefixo.
  function relAttr(node) {
    if (!node) return null;
    for (const a of node.attributes) if (a.localName === 'id' && (a.namespaceURI || '').includes('relationships')) return a.value;
    return null;
  }

  const esc = (s) =>
    String(s)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
      .replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  const html = MO.escapeHTML;

  // Relações de uma parte: id -> caminho absoluto dentro do arquivo (ou URL externo).
  function relsOf(files, part) {
    const dir = part.slice(0, part.lastIndexOf('/') + 1);
    const doc = parseXML(files, `${dir}_rels/${part.slice(dir.length)}.rels`);
    const map = {};
    for (const rel of all(doc, 'Relationship')) {
      const target = rel.getAttribute('Target') || '';
      const external = rel.getAttribute('TargetMode') === 'External';
      let path = target;
      if (!external) {
        const stack = target.startsWith('/') ? [] : dir.split('/').filter(Boolean);
        for (const seg of target.split('/')) {
          if (seg === '..') stack.pop();
          else if (seg && seg !== '.') stack.push(seg);
        }
        path = stack.join('/');
      }
      map[rel.getAttribute('Id')] = { path, external, type: (rel.getAttribute('Type') || '').split('/').pop() };
    }
    return map;
  }

  function toBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  function imageDataURL(files, path) {
    const type = IMAGE_TYPES[(path || '').split('.').pop().toLowerCase()];
    return type && files[path] ? `data:${type};base64,${toBase64(files[path])}` : null;
  }

  // data:image/png;base64,… -> { bytes, ext }
  function imageBytes(dataURL) {
    const m = /^data:image\/(png|jpeg|gif);base64,(.+)$/i.exec(dataURL || '');
    if (!m) return null;
    const bin = atob(m[2].replace(/\s+/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, ext: m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase() };
  }

  // "rgb(1, 2, 3)" ou "#abc" -> "AABBCC" (sem #), ou null.
  function hexColor(value) {
    if (!value) return null;
    let m = /^#([0-9a-f]{6})$/i.exec(value.trim());
    if (m) return m[1].toUpperCase();
    m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value.trim());
    if (m) return (m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toUpperCase();
    m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?/.exec(value);
    if (!m || m[4] === '0') return null;
    return [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  const fontName = (stack) => (stack || '').split(',')[0].replace(/["']/g, '').trim() || 'Arial';
  const isOn = (node) => Boolean(node) && !['0', 'false', 'none'].includes(attr(node, 'val') || '');

  // =====================================================================
  // DOCX
  // =====================================================================

  const HIGHLIGHT = { yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000', darkYellow: '#808000', lightGray: '#d3d3d3', darkGray: '#a9a9a9' };

  function importDocx(bytes) {
    const files = unzip(bytes);
    const doc = parseXML(files, 'word/document.xml');
    if (!doc) throw new Error('Documento inválido');
    const rels = relsOf(files, 'word/document.xml');

    // Estilos de parágrafo: o Word guarda o nome canónico em inglês ("heading 1") em qualquer idioma.
    const tags = {};
    const styleNum = {}; // listas definidas no estilo do parágrafo ("List Bullet", "List Number")
    const styleList = {};
    for (const style of all(parseXML(files, 'word/styles.xml'), 'style')) {
      const name = (attr(kid(style, 'name'), 'val') || '').toLowerCase();
      const id = attr(style, 'styleId');
      const m = /^heading ([1-6])$/.exec(name);
      if (m) tags[id] = 'h' + Math.min(3, Number(m[1]));
      else if (name === 'title') tags[id] = 'h1';
      else if (name === 'subtitle') tags[id] = 'h2';
      else if (name === 'quote' || name === 'intense quote') tags[id] = 'blockquote';
      const viaStyle = attr(first(first(style, 'numPr'), 'numId'), 'val');
      if (viaStyle) styleNum[id] = viaStyle;
      if (/^list (bullet|number)/.test(name)) styleList[id] = name.startsWith('list number') ? 'ol' : 'ul';
    }

    // Listas: numId -> lista numerada?
    const numbering = parseXML(files, 'word/numbering.xml');
    const abstractOrdered = {};
    for (const abs of all(numbering, 'abstractNum')) {
      const fmt = attr(first(kid(abs, 'lvl'), 'numFmt'), 'val');
      abstractOrdered[attr(abs, 'abstractNumId')] = Boolean(fmt) && fmt !== 'bullet' && fmt !== 'none';
    }
    const ordered = {};
    for (const num of kids(numbering && numbering.documentElement, 'num')) ordered[attr(num, 'numId')] = abstractOrdered[attr(kid(num, 'abstractNumId'), 'val')];

    // Comentários e notas de rodapé: texto simples de cada um, indexado pelo id do Word.
    const partByType = (type) => {
      const rel = Object.values(rels).find((item) => item.type === type);
      return rel ? parseXML(files, rel.path) : null;
    };
    const plainText = (node) => kids(node, 'p').map((p) => all(p, 't').map((t) => t.textContent).join('')).join('\n').trim();
    const comments = {};
    for (const c of all(partByType('comments'), 'comment')) {
      const id = attr(c, 'id');
      if (!/^\d{1,6}$/.test(id || '')) continue;
      const text = plainText(c);
      const author = attr(c, 'author');
      if (text) comments['c' + id] = { text: (author ? author + ': ' : '') + text, date: attr(c, 'date') || '' };
    }
    const notes = {};
    for (const n of all(partByType('footnotes'), 'footnote')) {
      const id = attr(n, 'id');
      if (attr(n, 'type') || !/^\d{1,6}$/.test(id || '')) continue;
      notes['f' + id] = plainText(n);
    }
    const openComments = [];

    function runHTML(run) {
      const rPr = kid(run, 'rPr');
      let out = '';
      for (const node of run.children) {
        if (node.localName === 't' || node.localName === 'delText') out += html(node.textContent);
        else if (node.localName === 'footnoteReference') {
          const id = attr(node, 'id');
          if (/^\d{1,6}$/.test(id || '') && notes['f' + id] != null) out += `<sup class="mo-fn" data-id="f${id}">0</sup>`;
        } else if (node.localName === 'tab') out += '\t';
        else if (node.localName === 'br') out += attr(node, 'type') === 'page' ? '\u0000' : '<br>';
        else if (node.localName === 'drawing' || node.localName === 'pict') {
          const blip = first(node, 'blip');
          const rel = blip && rels[attr(blip, 'embed')];
          const src = rel && imageDataURL(files, rel.path);
          const extent = first(node, 'extent');
          const width = extent ? Math.round(Number(attr(extent, 'cx')) / EMU) : 0;
          if (src) out += `<img src="${src}" alt=""${width > 0 && width < 2000 ? ` style="width: ${width}px"` : ''}>`;
        }
      }
      if (!out || !rPr) return out;
      const styles = [];
      const color = attr(kid(rPr, 'color'), 'val');
      if (color && /^[0-9a-f]{6}$/i.test(color)) styles.push(`color: #${color}`);
      const size = Number(attr(kid(rPr, 'sz'), 'val'));
      if (size > 0 && size < 400) styles.push(`font-size: ${size / 2}pt`);
      const mark = HIGHLIGHT[attr(kid(rPr, 'highlight'), 'val')];
      if (mark) styles.push(`background-color: ${mark}`);
      if (styles.length) out = `<span style="${styles.join('; ')}">${out}</span>`;
      if (isOn(kid(rPr, 'b'))) out = `<b>${out}</b>`;
      if (isOn(kid(rPr, 'i'))) out = `<i>${out}</i>`;
      if (isOn(kid(rPr, 'u'))) out = `<u>${out}</u>`;
      if (isOn(kid(rPr, 'strike'))) out = `<s>${out}</s>`;
      const va = attr(kid(rPr, 'vertAlign'), 'val');
      if (va === 'superscript') out = `<sup>${out}</sup>`;
      else if (va === 'subscript') out = `<sub>${out}</sub>`;
      return out;
    }

    function inlineHTML(parent) {
      let out = '';
      for (const node of parent.children) {
        if (node.localName === 'r') out += runHTML(node);
        else if (node.localName === 'hyperlink') {
          const rel = rels[relAttr(node)];
          const inner = inlineHTML(node);
          const href = rel && rel.external && /^(https?:|mailto:)/i.test(rel.path) ? rel.path : null;
          out += href ? `<a href="${html(href)}">${inner}</a>` : inner;
        } else if (node.localName === 'ins') out += `<ins class="mo-ins">${inlineHTML(node)}</ins>`;
        else if (node.localName === 'del') out += `<del class="mo-del">${inlineHTML(node)}</del>`;
        else if (node.localName === 'commentRangeStart') {
          const id = 'c' + attr(node, 'id');
          if (comments[id] && !openComments.includes(id)) { openComments.push(id); out += `<mark class="mo-comment" data-id="${id}">`; }
        } else if (node.localName === 'commentRangeEnd') {
          const at = openComments.indexOf('c' + attr(node, 'id'));
          if (at >= 0) { openComments.splice(at, 1); out += '</mark>'; }
        } else if (['smartTag', 'sdt', 'sdtContent', 'fldSimple'].includes(node.localName)) out += inlineHTML(node);
      }
      return out;
    }

    function blocksOf(container) {
      const out = [];
      let list = null;
      const closeList = () => {
        if (list) out.push(`<${list.tag}>${list.items.join('')}</${list.tag}>`);
        list = null;
      };
      for (const node of container.children) {
        if (node.localName === 'p') {
          const pPr = kid(node, 'pPr');
          const styleId = attr(kid(pPr, 'pStyle'), 'val');
          const numId = attr(first(kid(pPr, 'numPr'), 'numId'), 'val') || styleNum[styleId] || (styleList[styleId] ? 'style' : null);
          const align = { center: 'center', right: 'right', end: 'right', both: 'justify' }[attr(kid(pPr, 'jc'), 'val')];
          // Espaçamentos e avanço da primeira linha, em estilos CSS.
          const spc = kid(pPr, 'spacing');
          const ind = kid(pPr, 'ind');
          const extra = [];
          const line = Number(attr(spc, 'line'));
          if (line && (!attr(spc, 'lineRule') || attr(spc, 'lineRule') === 'auto') && line !== 240) extra.push(`line-height: ${Math.round((line / 240) * 100) / 100}`);
          const bef = attr(spc, 'before');
          const aft = attr(spc, 'after');
          if (bef != null && /^\d+$/.test(bef)) extra.push(`margin-top: ${Number(bef) / 20}pt`);
          if (aft != null && /^\d+$/.test(aft)) extra.push(`margin-bottom: ${Number(aft) / 20}pt`);
          const firstLine = Number(attr(ind, 'firstLine'));
          if (firstLine > 0) extra.push(`text-indent: ${Math.round(firstLine / 20)}pt`);
          // \u0000 marca uma quebra de página dentro do parágrafo.
          const reopen = openComments.map((id) => `<mark class="mo-comment" data-id="${id}">`).join('');
          const inner = inlineHTML(node);
          const parts = (reopen + inner + '</mark>'.repeat(openComments.length)).split('\u0000');
          parts.forEach((part, i) => {
            if (i > 0) {
              closeList();
              out.push('<hr class="page-break">');
            }
            if (numId && numId !== '0') {
              const tag = styleList[styleId] || (ordered[numId] ? 'ol' : 'ul');
              if (!list || list.tag !== tag) {
                closeList();
                list = { tag, items: [] };
              }
              list.items.push(`<li>${part || '<br>'}</li>`);
              return;
            }
            closeList();
            if (i > 0 && !part) return;
            const tag = tags[styleId] || 'p';
            const css = [align ? `text-align: ${align}` : '', ...extra].filter(Boolean).join('; ');
            out.push(`<${tag}${css ? ` style="${css}"` : ''}>${part || '<br>'}</${tag}>`);
          });
        } else if (node.localName === 'tbl') {
          closeList();
          // gridSpan -> colspan; vMerge (restart/continue) -> rowspan na célula de origem.
          const grid = []; // coluna -> célula de origem da fusão vertical em curso
          const rows = kids(node, 'tr').map((tr) => {
            const cells = [];
            let column = 0;
            for (const tc of kids(tr, 'tc')) {
              const tcPr = kid(tc, 'tcPr');
              const span = Math.max(1, Math.min(64, Number(attr(kid(tcPr, 'gridSpan'), 'val')) || 1));
              const vMerge = kid(tcPr, 'vMerge');
              const vVal = vMerge ? attr(vMerge, 'val') || 'continue' : null;
              if (vVal === 'continue' && grid[column]) {
                grid[column].rowspan++;
              } else {
                const cell = { html: kids(tc, 'p').map(inlineHTML).join('<br>') || '<br>', colspan: span, rowspan: 1 };
                cells.push(cell);
                for (let i = 0; i < span; i++) grid[column + i] = vVal === 'restart' ? cell : null;
              }
              column += span;
            }
            return cells;
          });
          const cellHTML = (c) => `<td${c.colspan > 1 ? ` colspan="${c.colspan}"` : ''}${c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : ''}>${c.html}</td>`;
          out.push(`<table><tbody>${rows.map((cells) => '<tr>' + cells.map(cellHTML).join('') + '</tr>').join('')}</tbody></table>`);
        } else if (node.localName === 'sdt') {
          closeList();
          const content = kid(node, 'sdtContent');
          if (content) out.push(...blocksOf(content));
        }
      }
      closeList();
      return out;
    }

    const body = first(doc, 'body');
    const pagePart = (type) => {
      const rel = Object.values(rels).find((item) => item.type === type);
      const part = rel && parseXML(files, rel.path);
      return part ? all(part, 't').filter((t) => {
        for (let parent = t.parentElement; parent; parent = parent.parentElement) if (parent.localName === 'fldSimple') return false;
        return true;
      }).map((t) => t.textContent).join('').replace(/\s+\/\s*$/, '').trim() : '';
    };  // o número de página é gerado pelo MyOffice; tira o separador " / " que sobra
    const sect = body && kids(body, 'sectPr')[0];
    const pgSz = kid(sect, 'pgSz');
    const pgMar = kid(sect, 'pgMar');
    let page = null;
    if (pgSz) {
      const w = Number(attr(pgSz, 'w')) || 11906;
      const hgt = Number(attr(pgSz, 'h')) || 16838;
      const short = Math.min(w, hgt);
      const size = Math.abs(short - 12240) < 150 ? 'Letter' : Math.abs(short - 8391) < 300 ? 'A5' : 'A4';
      const left = Number(attr(pgMar, 'left')) || 1134;
      const numCols = Number(attr(kid(sect, 'cols'), 'num')) || 1;
      page = { size, orient: w > hgt ? 'landscape' : 'portrait', margin: left <= 800 ? 'narrow' : left >= 1900 ? 'wide' : 'normal', columns: [2, 3].includes(numCols) ? numCols : 1 };
    }
    const html_ = body ? blocksOf(body).join('') : '';
    return { html: html_, header: pagePart('header'), footer: pagePart('footer'), comments, notes, page };
  }

  // root: elemento com o conteúdo do documento (o editor); look: tipos de letra e cores do tema.
  function exportDocx(root, look, pageParts = {}) {
    const media = {};
    const rels = [];
    let imageCount = 0;
    // Comentários, alterações controladas e notas de rodapé, exportados como objetos nativos do Word.
    const commentList = [];
    const noteList = [];
    let revision = 1;
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const relId = (type, target, external) => {
      rels.push(`<Relationship Id="rId${rels.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${esc(target)}"${external ? ' TargetMode="External"' : ''}/>`);
      return 'rId' + rels.length;
    };

    function runProps(fmt) {
      let out = '';
      if (fmt.b) out += '<w:b/>';
      if (fmt.i) out += '<w:i/>';
      if (fmt.s) out += '<w:strike/>';
      if (fmt.color) out += `<w:color w:val="${fmt.color}"/>`;
      if (fmt.size) out += `<w:sz w:val="${fmt.size}"/><w:szCs w:val="${fmt.size}"/>`;
      if (fmt.u) out += '<w:u w:val="single"/>';
      if (fmt.bg) out += `<w:shd w:val="clear" w:color="auto" w:fill="${fmt.bg}"/>`;
      if (fmt.va) out += `<w:vertAlign w:val="${fmt.va}"/>`;
      return out ? `<w:rPr>${out}</w:rPr>` : '';
    }

    function formatOf(el, base) {
      const fmt = { ...base };
      const tag = el.tagName;
      const st = el.style;
      const weight = st.fontWeight;
      if (tag === 'B' || tag === 'STRONG' || tag === 'TH' || weight === 'bold' || Number(weight) >= 600) fmt.b = true;
      if (weight === 'normal' || weight === '400') fmt.b = false;
      if (tag === 'I' || tag === 'EM' || st.fontStyle === 'italic') fmt.i = true;
      const deco = st.textDecorationLine || st.textDecoration || '';
      if (tag === 'U' || deco.includes('underline')) fmt.u = true;
      if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL' || deco.includes('line-through')) fmt.s = true;
      const color = hexColor(st.color || (tag === 'FONT' ? el.getAttribute('color') : ''));
      if (color) fmt.color = color;
      const bg = hexColor(st.backgroundColor);
      if (bg) fmt.bg = bg;
      const size = /^([\d.]+)(pt|px)$/.exec(st.fontSize || '');
      if (size) fmt.size = Math.round(Number(size[1]) * (size[2] === 'px' ? 1.5 : 2));
      if (tag === 'A') Object.assign(fmt, { color: fmt.color || '1F5FBF', u: true });
      if ((tag === 'SUP' && !el.classList.contains('mo-fn')) || st.verticalAlign === 'super') fmt.va = 'superscript';
      if (tag === 'SUB' || st.verticalAlign === 'sub') fmt.va = 'subscript';
      return fmt;
    }

    function imageRun(img) {
      const data = imageBytes(img.getAttribute('src'));
      if (!data) return '';
      imageCount++;
      const name = `image${imageCount}.${data.ext}`;
      media['word/media/' + name] = data.bytes;
      const id = relId('image', 'media/' + name);
      const natural = { w: img.naturalWidth || 300, h: img.naturalHeight || 200 };
      const width = Math.min(img.clientWidth || natural.w, 620);
      const cx = Math.round(width * EMU);
      const cy = Math.round((width * natural.h) / natural.w) * EMU;
      return (
        `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${imageCount}" name="Imagem ${imageCount}"/>` +
        '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
        `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${imageCount}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
        `<pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
        `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
        '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
      );
    }

    const BLOCKS = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'DIV', 'UL', 'OL', 'LI', 'TABLE', 'HR'];

    function inline(node, fmt) {
      let out = '';
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          const pieces = child.nodeValue.split('\t');
          pieces.forEach((piece, i) => {
            if (i > 0) out += `<w:r>${runProps(fmt)}<w:tab/></w:r>`;
            if (piece) out += fmt.del ? `<w:r>${runProps(fmt)}<w:delText xml:space="preserve">${esc(piece)}</w:delText></w:r>` : `<w:r>${runProps(fmt)}<w:t xml:space="preserve">${esc(piece)}</w:t></w:r>`;
          });
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          if (child.tagName === 'BR') out += '<w:r><w:br/></w:r>';
          else if (child.tagName === 'IMG') out += imageRun(child);
          else if (BLOCKS.includes(child.tagName)) continue; // os blocos aninhados são tratados por blocks()
          else if (child.tagName === 'MARK' && child.classList.contains('mo-comment') && pageParts.comments && pageParts.comments[child.dataset.id]) {
            const id = commentList.push(pageParts.comments[child.dataset.id]) - 1;
            out += `<w:commentRangeStart w:id="${id}"/>${inline(child, fmt)}<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r>`;
          } else if (child.tagName === 'INS' && child.classList.contains('mo-ins')) {
            out += `<w:ins w:id="${revision++}" w:author="MyOffice" w:date="${now}">${inline(child, fmt)}</w:ins>`;
          } else if (child.tagName === 'DEL' && child.classList.contains('mo-del')) {
            out += `<w:del w:id="${revision++}" w:author="MyOffice" w:date="${now}">${inline(child, { ...fmt, del: true })}</w:del>`;
          } else if (child.tagName === 'SUP' && child.classList.contains('mo-fn') && pageParts.notes && pageParts.notes[child.dataset.id] != null) {
            const id = noteList.push(pageParts.notes[child.dataset.id]);
            out += `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`;
          }
          else if (child.tagName === 'A' && /^(https?:|mailto:)/i.test(child.getAttribute('href') || '')) {
            out += `<w:hyperlink r:id="${relId('hyperlink', child.getAttribute('href'), true)}">${inline(child, formatOf(child, fmt))}</w:hyperlink>`;
          } else out += inline(child, formatOf(child, fmt));
        }
      }
      return out;
    }

    function paragraph(el, opts) {
      let props = '';
      if (opts.style) props += `<w:pStyle w:val="${opts.style}"/>`;
      if (opts.list) props += `<w:numPr><w:ilvl w:val="${opts.level}"/><w:numId w:val="${opts.list}"/></w:numPr>`;
      // Espaçamento entre linhas, antes e depois, e avanço da primeira linha.
      const st = el.style || {};
      const twips = (v) => { const m = /^(-?[\d.]+)(pt|px|cm|mm)?$/.exec(String(v || '').trim()); if (!m) return null; const n = Number(m[1]); return Math.round(m[2] === 'px' ? n * 15 : m[2] === 'cm' ? n * 567 : m[2] === 'mm' ? n * 56.7 : n * 20); };
      const spacing = [];
      const before = twips(st.marginTop);
      const after = twips(st.marginBottom);
      if (before != null) spacing.push(`w:before="${Math.max(0, before)}"`);
      if (after != null) spacing.push(`w:after="${Math.max(0, after)}"`);
      const lh = /^([\d.]+)(%)?$/.exec(String(st.lineHeight || ''));
      if (lh) spacing.push(`w:line="${Math.round((lh[2] ? Number(lh[1]) / 100 : Number(lh[1])) * 240)}" w:lineRule="auto"`);
      if (spacing.length) props += `<w:spacing ${spacing.join(' ')}/>`;
      const indent = twips(st.textIndent);
      if (indent) props += `<w:ind w:firstLine="${Math.max(0, indent)}"/>`;
      const align = { center: 'center', right: 'right', justify: 'both' }[el.style ? el.style.textAlign : ''];
      if (align) props += `<w:jc w:val="${align}"/>`;
      return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${inline(el, formatOf(el, {}))}</w:p>`;
    }

    const hasBlocks = (el) => [...el.children].some((c) => BLOCKS.includes(c.tagName));

    function blocks(container, ctx) {
      let out = '';
      let loose = null; // texto solto fora de qualquer bloco
      const flush = () => {
        if (loose && loose.textContent.trim()) out += paragraph(loose, {});
        loose = null;
      };
      for (const node of container.childNodes) {
        const tag = node.nodeType === Node.ELEMENT_NODE ? node.tagName : null;
        if (!tag || !BLOCKS.includes(tag)) {
          if (!loose) loose = document.createElement('div');
          loose.append(node.cloneNode(true));
          continue;
        }
        flush();
        if (tag === 'UL' || tag === 'OL') out += blocks(node, { list: tag === 'OL' ? 2 : 1, level: ctx.list ? ctx.level + 1 : 0 });
        else if (tag === 'LI') {
          out += paragraph(node, { list: ctx.list || 1, level: Math.min(ctx.level || 0, 8) });
          if (hasBlocks(node)) out += blocks(node, { list: ctx.list, level: (ctx.level || 0) + 1, nestedOnly: true });
        } else if (tag === 'TABLE') {
          // colspan -> gridSpan; rowspan -> vMerge, com células de continuação nas linhas seguintes.
          const pending = []; // coluna -> { left, span } de fusões verticais
          const rows = [...node.rows].map((tr) => {
            let xml = '';
            let column = 0;
            const cont = () => {
              while (pending[column] && pending[column].left > 0) {
                const p = pending[column];
                p.left--;
                xml += `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>${p.span > 1 ? `<w:gridSpan w:val="${p.span}"/>` : ''}<w:vMerge/></w:tcPr><w:p/></w:tc>`;
                column += p.span;
              }
            };
            for (const td of tr.cells) {
              cont();
              const span = Math.max(1, Math.min(64, td.colSpan || 1));
              const down = Math.max(1, Math.min(1000, td.rowSpan || 1));
              if (down > 1) pending[column] = { left: down - 1, span };
              const shade = hexColor(td.style.backgroundColor);
              xml += `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}${down > 1 ? '<w:vMerge w:val="restart"/>' : ''}${shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : ''}</w:tcPr>${paragraph(td, td.tagName === 'TH' ? { b: true } : {})}</w:tc>`;
              column += span;
            }
            cont();
            // Linha de cabeçalho: repete-se no topo de cada página.
            return '<w:tr>' + ([...tr.cells].some((c) => c.tagName === 'TH') ? '<w:trPr><w:tblHeader/></w:trPr>' : '') + xml + '</w:tr>';
          });
          const border = (side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="9AA1B1"/>`;
          out += `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders></w:tblPr>${rows.join('')}</w:tbl><w:p/>`;
        } else if (tag === 'HR') {
          out += node.classList.contains('page-break')
            ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
            : '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="9AA1B1"/></w:pBdr></w:pPr></w:p>';
        } else if (ctx.nestedOnly) {
          continue;
        } else if (tag === 'DIV' && hasBlocks(node)) {
          out += blocks(node, ctx);
        } else {
          const style = { H1: 'Heading1', H2: 'Heading2', H3: 'Heading3', H4: 'Heading3', H5: 'Heading3', H6: 'Heading3', BLOCKQUOTE: 'Quote' }[tag];
          out += paragraph(node, { style });
        }
      }
      flush();
      return out;
    }

    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const body = blocks(root, {}) || '<w:p/>';
    const headerXml = `<w:hdr ${W}><w:p><w:r><w:t xml:space="preserve">${esc(pageParts.header || '')}</w:t></w:r></w:p></w:hdr>`;
    const footerXml = `<w:ftr ${W}><w:p><w:r><w:t xml:space="preserve">${esc(pageParts.footer || '')}</w:t></w:r><w:r><w:t xml:space="preserve">  </w:t></w:r><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple><w:r><w:t xml:space="preserve"> / </w:t></w:r><w:fldSimple w:instr="NUMPAGES"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>`;
    const headFont = esc(fontName(look.head));
    const bodyFont = esc(fontName(look.body));
    const headColor = hexColor(look.color) || '1C2130';
    const heading = (id, name, size, before) =>
      `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>` +
      `<w:pPr><w:keepNext/><w:spacing w:before="${before}" w:after="160"/><w:outlineLvl w:val="${Number(id.slice(-1)) - 1}"/></w:pPr>` +
      `<w:rPr><w:rFonts w:ascii="${headFont}" w:hAnsi="${headFont}" w:cs="${headFont}"/><w:b/><w:color w:val="${headColor}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
    const level = (i, fmt, text, font) =>
      `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/>` +
      `<w:pPr><w:ind w:left="${720 * (i + 1)}" w:hanging="360"/></w:pPr>${font ? `<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:hint="default"/></w:rPr>` : ''}</w:lvl>`;
    const levels = (ordered) => Array.from({ length: 9 }, (_x, i) => (ordered ? level(i, 'decimal', `%${i + 1}.`) : level(i, 'bullet', '•', 'Arial'))).join('');

    // Tamanho, orientação e margens da página (em vigésimos de ponto, como no Word).
    function pageSize() {
      const pg = pageParts.page || {};
      const mm = (x) => Math.round(x * 56.6929);
      const sizes = { A4: [210, 297], Letter: [215.9, 279.4], A5: [148, 210] };
      let [w, hgt] = sizes[pg.size] || sizes.A4;
      if (pg.orient === 'landscape') [w, hgt] = [hgt, w];
      const m = { normal: [25, 20], narrow: [12.7, 12.7], wide: [25.4, 38.1] }[pg.margin] || [25, 20];
      const cols = [2, 3].includes(pg.columns) ? `<w:cols w:num="${pg.columns}" w:space="567"/>` : '';
      return `<w:pgSz w:w="${mm(w)}" w:h="${mm(hgt)}"${pg.orient === 'landscape' ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${mm(m[0])}" w:right="${mm(m[1])}" w:bottom="${mm(m[0])}" w:left="${mm(m[1])}" w:header="708" w:footer="708" w:gutter="0"/>${cols}`;
    }
    const textParagraphs = (text) => String(text || '').split(/\n/).map((line) => `<w:p><w:r><w:t xml:space="preserve">${esc(line)}</w:t></w:r></w:p>`).join('');
    const extraParts = {};
    const extraTypes = [];
    const extraRels = [];
    if (commentList.length) {
      extraParts['word/comments.xml'] = XML_HEAD + `<w:comments ${W}>${commentList.map((c, i) => `<w:comment w:id="${i}" w:author="${esc(c.author || 'MyOffice')}" w:date="${esc(c.date || now)}" w:initials="MO">${textParagraphs(c.text)}</w:comment>`).join('')}</w:comments>`;
      extraTypes.push('<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>');
      extraRels.push('<Relationship Id="rIdComments" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>');
    }
    if (noteList.length) {
      extraParts['word/footnotes.xml'] = XML_HEAD + `<w:footnotes ${W}><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
        noteList.map((text, i) => `<w:footnote w:id="${i + 1}"><w:p><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> ${esc(text)}</w:t></w:r></w:p></w:footnote>`).join('') + '</w:footnotes>';
      extraTypes.push('<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>');
      extraRels.push('<Relationship Id="rIdFootnotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>');
    }

    return zip({
      '[Content_Types].xml':
        XML_HEAD +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/>' +
        extraTypes.join('') +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>',
      '_rels/.rels':
        XML_HEAD +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      'word/document.xml':
        XML_HEAD +
        `<w:document ${W} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">` +
        `<w:body>${body}<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/>${pageSize()}</w:sectPr></w:body></w:document>`,
      'word/styles.xml':
        XML_HEAD +
        `<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${bodyFont}" w:hAnsi="${bodyFont}" w:cs="${bodyFont}"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="pt-PT"/></w:rPr></w:rPrDefault>` +
        '<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="340" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
        heading('Heading1', 'heading 1', 48, 240) +
        heading('Heading2', 'heading 2', 36, 280) +
        heading('Heading3', 'heading 3', 28, 240) +
        '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="480"/></w:pPr><w:rPr><w:i/><w:color w:val="4A5263"/></w:rPr></w:style></w:styles>',
      'word/numbering.xml':
        XML_HEAD +
        `<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${levels(false)}</w:abstractNum>` +
        `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${levels(true)}</w:abstractNum>` +
        '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>',
      'word/_rels/document.xml.rels':
        XML_HEAD +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `<Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>` +
        '<Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>' +
        '<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' +
        `${extraRels.join('')}${rels.join('')}</Relationships>`,
      ...extraParts,
      'word/header1.xml': XML_HEAD + headerXml,
      'word/footer1.xml': XML_HEAD + footerXml,
      ...media
    });
  }

  // =====================================================================
  // XLSX
  // =====================================================================

  const argb = (value) => (value && /^[0-9a-f]{8}$/i.test(value) ? '#' + value.slice(2).toLowerCase() : value && /^[0-9a-f]{6}$/i.test(value) ? '#' + value.toLowerCase() : null);

  function numberFormat(id, code) {
    if (id === 9 || id === 10) return 'pct';
    if (id === 2 || id === 4) return 'num2';
    if ((id >= 5 && id <= 8) || id === 44 || id === 42) return 'eur';
    if (!code) return null;
    if (code.includes('%')) return 'pct';
    if (/[€$£]|\[\$/.test(code)) return 'eur';
    if (/^[#,0 ]*0\.00$/.test(code)) return 'num2';
    return null;
  }

  // Devolve { cells, clipped }: clipped indica que havia dados fora dos limites da grelha.
  function importXlsx(bytes, rows, cols) {
    const files = unzip(bytes);
    const workbook = parseXML(files, 'xl/workbook.xml');
    if (!workbook) throw new Error('Livro inválido');
    const wbRels = relsOf(files, 'xl/workbook.xml');
    const sheetEls = all(workbook, 'sheet');
    if (!sheetEls.length) throw new Error('O livro não contém folhas.');

    const strings = all(parseXML(files, 'xl/sharedStrings.xml'), 'si').map((si) =>
      all(si, 't')
        .filter((t) => t.parentNode.localName !== 'rPh')
        .map((t) => t.textContent)
        .join('')
    );

    // Estilos: cada célula aponta para uma entrada de cellXfs.
    const stylesDoc = parseXML(files, 'xl/styles.xml');
    const customFormats = {};
    for (const nf of all(stylesDoc, 'numFmt')) customFormats[attr(nf, 'numFmtId')] = attr(nf, 'formatCode');
    const fonts = kids(first(stylesDoc, 'fonts'), 'font');
    const fills = kids(first(stylesDoc, 'fills'), 'fill');
    // Bordas: cada lado com estilo definido conta como borda.
    const borders = kids(first(stylesDoc, 'borders'), 'border').map((border) =>
      [['top', 't'], ['bottom', 'b'], ['left', 'l'], ['right', 'r']].filter(([side]) => {
        const style = attr(kid(border, side), 'style');
        return style && style !== 'none';
      }).map(([, k]) => k).join('')
    );
    // Formatos diferenciais (dxf) usados pela formatação condicional: cor de fundo e do texto.
    const argb = (node) => { const v = attr(node, 'rgb'); return v && /^[0-9a-f]{8}$/i.test(v) ? '#' + v.slice(2).toLowerCase() : null; };
    const dxfs = kids(first(stylesDoc, 'dxfs'), 'dxf').map((dxf) => ({
      bg: argb(first(first(dxf, 'fill'), 'bgColor')) || argb(first(first(dxf, 'fill'), 'fgColor')),
      c: argb(first(first(dxf, 'font'), 'color'))
    }));
    const xfs = kids(first(stylesDoc, 'cellXfs'), 'xf').map((xf) => {
      const s = {};
      const bd = borders[Number(attr(xf, 'borderId'))];
      if (bd) s.bd = bd;
      const font = fonts[Number(attr(xf, 'fontId'))];
      if (font && isOn(kid(font, 'b'))) s.b = 1;
      if (font && isOn(kid(font, 'i'))) s.i = 1;
      const color = font && argb(attr(kid(font, 'color'), 'rgb'));
      if (color && color !== '#000000') s.c = color;
      const pattern = kid(fills[Number(attr(xf, 'fillId'))], 'patternFill');
      const bg = pattern && attr(pattern, 'patternType') === 'solid' && argb(attr(kid(pattern, 'fgColor'), 'rgb'));
      if (bg) s.bg = bg;
      const align = attr(kid(xf, 'alignment'), 'horizontal');
      if (['left', 'center', 'right'].includes(align)) s.a = align;
      const fmtId = Number(attr(xf, 'numFmtId'));
      const fmt = numberFormat(fmtId, customFormats[fmtId]);
      if (fmt) s.f = fmt;
      return s;
    });

    const importedSheets = [];
    let clipped = sheetEls.length > 100;
    for (const [index, sheetEl] of sheetEls.slice(0, 100).entries()) {
      const sheetRel = wbRels[relAttr(sheetEl)];
      const sheet = parseXML(files, sheetRel ? sheetRel.path : `xl/worksheets/sheet${index + 1}.xml`);
      if (!sheet) continue;
      const cells = {};
      for (const c of all(sheet, 'c')) {
        const pos = F.parseAddr(attr(c, 'r') || '');
        if (!pos) continue;
        if (pos.r >= rows || pos.c >= cols) {
          clipped = clipped || Boolean(kid(c, 'v') || kid(c, 'f') || kid(c, 'is'));
          continue;
        }
        const type = attr(c, 't');
        const formula = kid(c, 'f');
        const v = kid(c, 'v');
        let raw = '';
        if (formula && formula.textContent) raw = '=' + formula.textContent;
        else if (type === 's') raw = strings[Number(v && v.textContent)] || '';
        else if (type === 'inlineStr') raw = all(kid(c, 'is'), 't').map((t) => t.textContent).join('');
        else if (type === 'b') raw = v && v.textContent === '1' ? 'VERDADEIRO' : 'FALSO';
        else if (v) raw = v.textContent;
        const isText = !formula && (type === 's' || type === 'inlineStr' || type === 'str');
        if (isText && raw && (raw[0] === '=' || raw[0] === "'" || F.parseNumber(raw) !== null)) raw = "'" + raw;
        const style = xfs[Number(attr(c, 's'))];
        const cell = { v: raw };
        if (style && Object.keys(style).length) cell.s = { ...style };
        if (cell.v !== '' || cell.s) cells[F.addr(pos.r, pos.c)] = cell;
      }
      const name = attr(sheetEl, 'name') || `Folha${index + 1}`;
      const charts = [];
      const sheetRels = relsOf(files, sheetRel ? sheetRel.path : `xl/worksheets/sheet${index + 1}.xml`);
      for (const drawingRef of all(sheet, 'drawing')) {
        const drawingRel = sheetRels[relAttr(drawingRef)];
        const drawing = drawingRel && parseXML(files, drawingRel.path);
        if (!drawing) continue;
        const chartRels = relsOf(files, drawingRel.path);
        for (const chartRef of all(drawing, 'chart')) {
          const chartRel = chartRels[relAttr(chartRef)];
          const chartDoc = chartRel && parseXML(files, chartRel.path);
          if (!chartDoc) continue;
          const barNode = first(chartDoc, 'barChart');
          const chartType = barNode
            ? (attr(first(barNode, 'barDir'), 'val') === 'bar' ? 'bar' : /stacked/i.test(attr(first(barNode, 'grouping'), 'val') || '') ? 'stacked' : 'column')
            : first(chartDoc, 'lineChart') ? 'line' : first(chartDoc, 'areaChart') ? 'area' : first(chartDoc, 'doughnutChart') ? 'doughnut' : first(chartDoc, 'pieChart') ? 'pie' : first(chartDoc, 'scatterChart') ? 'scatter' : null;
          const parseChartRange = (formula) => {
            const ref = String(formula || '').split('!').pop().replace(/\$/g, '');
            const parts = ref.split(':');
            return parts.length === 2 ? [F.parseAddr(parts[0]), F.parseAddr(parts[1])] : null;
          };
          const sers = all(chartDoc, 'ser');
          const cat = parseChartRange(first(first(sers[0], 'cat') || first(sers[0], 'xVal'), 'f')?.textContent);
          const vals = sers.map((ser) => parseChartRange(first(first(ser, 'val') || first(ser, 'yVal'), 'f')?.textContent)).filter((v) => v && v[0] && v[1]);
          if (!chartType || !cat || !cat[0] || !cat[1] || !vals.length) continue;
          // Só intervalos simples: categorias numa coluna e valores nas colunas à direita, nas mesmas linhas.
          if (cat[0].c !== cat[1].c || cat[0].r < 1 || vals.some((v) => v[0].r !== cat[0].r || v[1].r !== cat[1].r || v[0].c !== v[1].c || v[0].c <= cat[0].c)) continue;
          const titleText = all(first(first(chartDoc, 'chart'), 'title'), 't').map((t) => t.textContent).join('').slice(0, 120);
          const anchor = first(chartRef.parentElement && chartRef.closest ? chartRef.closest('twoCellAnchor') || chartRef.closest('oneCellAnchor') : null, 'from');
          const aCol = Number(first(anchor, 'col')?.textContent) || 0;
          const aRow = Number(first(anchor, 'row')?.textContent) || 0;
          charts.push({
            name: `Gráfico ${charts.length + 1}`, type: chartType, title: titleText, legend: Boolean(first(chartDoc, 'legend')), labels: false, palette: 'office',
            range: { r0: cat[0].r - 1, r1: cat[1].r, c0: cat[0].c, c1: Math.max(...vals.map((v) => v[1].c)) },
            x: 46 + aCol * 104, y: 26 + aRow * 26, w: 520, h: 320
          });
        }
      }
      // Células unidas, larguras das colunas e painéis fixos.
      const merges = [];
      for (const mc of all(sheet, 'mergeCell')) {
        const [from, to] = String(attr(mc, 'ref') || '').split(':').map((x) => F.parseAddr(x));
        if (from && to && to.r < rows && to.c < cols) merges.push({ r0: Math.min(from.r, to.r), r1: Math.max(from.r, to.r), c0: Math.min(from.c, to.c), c1: Math.max(from.c, to.c) });
      }
      const widths = {};
      for (const col of all(first(sheet, 'cols'), 'col')) {
        const w = Number(attr(col, 'width'));
        const min = Number(attr(col, 'min'));
        const max = Math.min(Number(attr(col, 'max')), min + 300, cols);
        if (!Number.isFinite(w) || !Number.isInteger(min) || min < 1) continue;
        // A largura do Excel está em carateres; cerca de 7 píxeis por caráter mais margem.
        for (let c = min; c <= max; c++) widths[c - 1] = Math.max(24, Math.min(600, Math.round(w * 7 + 5)));
      }
      let freeze = null;
      const pane = first(first(sheet, 'sheetView'), 'pane');
      if (pane && /frozen/.test(attr(pane, 'state') || '')) {
        const ys = Math.round(Number(attr(pane, 'ySplit')) || 0);
        const xs = Math.round(Number(attr(pane, 'xSplit')) || 0);
        if (ys || xs) freeze = { rows: Math.min(50, ys), cols: Math.min(20, xs) };
      }
      const rules = [];
      const OPS = { greaterThan: 'gt', lessThan: 'lt', between: 'between', equal: 'eq' };
      for (const cf of all(sheet, 'conditionalFormatting')) {
        const [from, to] = String(attr(cf, 'sqref') || '').split(/\s+/)[0].split(':').map((x) => F.parseAddr(x));
        if (!from) continue;
        const end = to || from;
        const range = { r0: Math.min(from.r, end.r), r1: Math.min(rows - 1, Math.max(from.r, end.r)), c0: Math.min(from.c, end.c), c1: Math.min(cols - 1, Math.max(from.c, end.c)) };
        for (const rule of kids(cf, 'cfRule')) {
          const kind = attr(rule, 'type');
          const formulas = kids(rule, 'formula').map((f) => f.textContent.replace(/^"|"$/g, ''));
          const look = attr(rule, 'dxfId') != null ? dxfs[Number(attr(rule, 'dxfId'))] || {} : {};
          let type = null; let a = ''; let b = '';
          if (kind === 'colorScale') type = 'scale';
          else if (kind === 'cellIs' && OPS[attr(rule, 'operator')]) { type = OPS[attr(rule, 'operator')]; a = formulas[0] || ''; b = formulas[1] || ''; }
          else if (kind === 'containsText') { type = 'text'; a = attr(rule, 'text') || ''; }
          if (!type || rules.length >= 200) continue;
          const out = { range, type, a, b };
          if (look.bg) out.bg = look.bg;
          if (look.c) out.c = look.c;
          rules.push(out);
        }
      }
      importedSheets.push({ name, cells, charts, merges, widths, freeze, rules });
    }
    return { sheets: importedSheets, clipped };
  }

  // cells: modelo da folha; values: Map endereço -> valor calculado.
  function exportXlsx(input, legacyValues) {
    const sheets = (Array.isArray(input) ? input.slice(0, 100) : [{ name: 'Folha1', cells: input, values: legacyValues }]);
    if (!sheets.length) sheets.push({ name: 'Folha1', cells: {}, values: new Map() });
    const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
    const fonts = ['<font><sz val="11"/><name val="Calibri"/></font>'];
    const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
    const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
    const index = (list, item) => (list.includes(item) ? list.indexOf(item) : list.push(item) - 1);
    const NUM_FMT = { num2: 2, pct: 10, eur: 164 };
    const borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
    const borderXML = (bd) => {
      const side = (name, k) => (bd.includes(k) ? `<${name} style="thin"><color rgb="FF1D2622"/></${name}>` : `<${name}/>`);
      return `<border>${side('left', 'l')}${side('right', 'r')}${side('top', 't')}${side('bottom', 'b')}<diagonal/></border>`;
    };

    function styleIndex(s) {
      if (!s) return 0;
      const font = index(fonts, `<font>${s.b ? '<b/>' : ''}${s.i ? '<i/>' : ''}<sz val="11"/>${s.c ? `<color rgb="FF${s.c.slice(1).toUpperCase()}"/>` : ''}<name val="Calibri"/></font>`);
      const fill = s.bg ? index(fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${s.bg.slice(1).toUpperCase()}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
      const fmt = NUM_FMT[s.f] || 0;
      const border = s.bd ? index(borders, borderXML(s.bd)) : 0;
      return index(
        xfs,
        `<xf numFmtId="${fmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"${fmt ? ' applyNumberFormat="1"' : ''}${font ? ' applyFont="1"' : ''}${fill ? ' applyFill="1"' : ''}${border ? ' applyBorder="1"' : ''}` +
          (s.a ? ` applyAlignment="1"><alignment horizontal="${s.a}"/></xf>` : '/>')
      );
    }

    // Painéis fixos, larguras (em carateres, como no Excel) e células unidas de cada folha.
    function sheetView(fz) {
      if (!fz || !(fz.rows || fz.cols)) return '';
      const cell = F.addr(fz.rows || 0, fz.cols || 0);
      const pane = fz.rows && fz.cols ? 'bottomRight' : fz.rows ? 'bottomLeft' : 'topRight';
      return `<sheetViews><sheetView workbookViewId="0"><pane${fz.cols ? ` xSplit="${fz.cols}"` : ''}${fz.rows ? ` ySplit="${fz.rows}"` : ''} topLeftCell="${cell}" activePane="${pane}" state="frozen"/></sheetView></sheetViews>`;
    }
    function colsXML(widths) {
      const custom = Object.entries(widths || {}).map(([c, w]) => [Number(c), w]).filter(([c, w]) => Number.isInteger(c) && c >= 0 && c < 256 && Number.isFinite(w)).sort((x, y) => x[0] - y[0]);
      const out = [];
      let next = 0;
      for (const [c, w] of custom) {
        if (c > next) out.push(`<col min="${next + 1}" max="${c}" width="14" customWidth="1"/>`);
        out.push(`<col min="${c + 1}" max="${c + 1}" width="${Math.max(1, (w - 5) / 7).toFixed(2)}" customWidth="1"/>`);
        next = c + 1;
      }
      if (next < 256) out.push(`<col min="${next + 1}" max="256" width="14" customWidth="1"/>`);
      return `<cols>${out.join('')}</cols>`;
    }
    // Formatação condicional: regras do MyOffice -> conditionalFormatting + dxfs em styles.xml.
    const dxfList = [];
    const xmlEsc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const cfValue = (v) => (v !== '' && F.parseNumber(String(v)) !== null ? String(F.parseNumber(String(v))) : `"${xmlEsc(String(v).replace(/"/g, '""'))}"`);
    function rulesXML(rules) {
      let priority = 1;
      return (Array.isArray(rules) ? rules : []).map((rule) => {
        const g = rule.range;
        if (!g) return '';
        const ref = `${F.addr(g.r0, g.c0)}:${F.addr(g.r1, g.c1)}`;
        if (rule.type === 'scale') {
          return `<conditionalFormatting sqref="${ref}"><cfRule type="colorScale" priority="${priority++}"><colorScale><cfvo type="min"/><cfvo type="percentile" val="50"/><cfvo type="max"/><color rgb="FFF8696B"/><color rgb="FFFFEB84"/><color rgb="FF63BE7B"/></colorScale></cfRule></conditionalFormatting>`;
        }
        const hex = (x) => 'FF' + String(x || '').replace('#', '').toUpperCase();
        const dxf = `<dxf>${rule.c ? `<font><color rgb="${hex(rule.c)}"/></font>` : ''}${rule.bg ? `<fill><patternFill><bgColor rgb="${hex(rule.bg)}"/></patternFill></fill>` : ''}</dxf>`;
        const id = index(dxfList, dxf);
        if (rule.type === 'text') {
          const t = xmlEsc(rule.a);
          return `<conditionalFormatting sqref="${ref}"><cfRule type="containsText" dxfId="${id}" priority="${priority++}" operator="containsText" text="${t}"><formula>NOT(ISERROR(SEARCH("${t.replace(/&quot;/g, '""')}",${F.addr(g.r0, g.c0)})))</formula></cfRule></conditionalFormatting>`;
        }
        const op = { gt: 'greaterThan', lt: 'lessThan', between: 'between', eq: 'equal' }[rule.type];
        if (!op) return '';
        const formulas = `<formula>${cfValue(rule.a)}</formula>${rule.type === 'between' ? `<formula>${cfValue(rule.b)}</formula>` : ''}`;
        return `<conditionalFormatting sqref="${ref}"><cfRule type="cellIs" dxfId="${id}" priority="${priority++}" operator="${op}">${formulas}</cfRule></conditionalFormatting>`;
      }).join('');
    }

    function mergeXML(merges) {
      const list = (Array.isArray(merges) ? merges : []).filter((m) => m && [m.r0, m.r1, m.c0, m.c1].every(Number.isInteger));
      return list.length ? `<mergeCells count="${list.length}">${list.map((m) => `<mergeCell ref="${F.addr(m.r0, m.c0)}:${F.addr(m.r1, m.c1)}"/>`).join('')}</mergeCells>` : '';
    }

    const sheetFiles = {};
    const chartFiles = {};
    const drawingFiles = {};
    const sheetParts = [];
    const sheetRels = [];
    const sheetOverrides = [];
    let chartCount = 0;
    const chartOverrides = [];
    const drawingOverrides = [];
    for (const [i, sheet] of sheets.entries()) {
      const byRow = new Map();
      for (const [a, cell] of Object.entries(sheet.cells || {})) {
        const pos = F.parseAddr(a);
        if (!pos) continue;
        if (!byRow.has(pos.r)) byRow.set(pos.r, []);
        byRow.get(pos.r).push({ a, c: pos.c, cell });
      }
      let rowsXML = '';
      for (const r of [...byRow.keys()].sort((x, y) => x - y)) {
        let row = '';
        for (const { a, cell } of byRow.get(r).sort((x, y) => x.c - y.c)) {
          const style = styleIndex(cell.s);
          const sAttr = style ? ` s="${style}"` : '';
          const raw = cell.v || '';
          const value = sheet.values ? sheet.values.get(a) : null;
          const isFormula = raw.length > 1 && raw[0] === '=';
          const f = isFormula ? `<f>${esc(F.toExcel(raw))}</f>` : '';
          if (raw === '') row += `<c r="${a}"${sAttr}/>`;
          else if (typeof value === 'number') row += `<c r="${a}"${sAttr}>${f}<v>${value}</v></c>`;
          else if (typeof value === 'boolean') row += `<c r="${a}"${sAttr} t="b">${f}<v>${value ? 1 : 0}</v></c>`;
          else if (isFormula) row += typeof value === 'string' ? `<c r="${a}"${sAttr} t="str">${f}<v>${esc(value)}</v></c>` : `<c r="${a}"${sAttr}>${f}</c>`;
          else row += `<c r="${a}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${esc(String(value == null ? raw : value))}</t></is></c>`;
        }
        rowsXML += `<row r="${r + 1}">${row}</row>`;
      }
      const safeName = String(sheet.name || `Folha${i + 1}`).replace(/[\\/*?:\[\]]/g, '').slice(0, 31) || `Folha${i + 1}`;
      const charts = Array.isArray(sheet.charts) ? sheet.charts.slice(0, 50) : [];
      let drawingTag = '';
      if (charts.length) {
        const drawingName = `drawing${i + 1}`;
        const drawingRels = [];
        const frames = [];
        const widthsPx = sheet.widths || {};
        const colAtX = (x) => { let left = 46; for (let c = 0; c < 255; c++) { const w = Number(widthsPx[c]) || 104; if (left + w > x) return { col: c, off: Math.round((x - left) * 9525) }; left += w; } return { col: 255, off: 0 }; };
        const rowAtY = (y) => { const r = Math.max(0, (y - 26) / 26); return { row: Math.floor(r), off: Math.round((r % 1) * 26 * 9525) }; };
        const KINDS = ['column', 'stacked', 'bar', 'line', 'area', 'pie', 'doughnut', 'scatter'];
        for (const chart of charts) {
          const range = chart && chart.range;
          const kind = chart && (chart.type === 'bar' && chart.x == null ? 'column' : chart.type);
          if (!range || !KINDS.includes(kind) || ![range.r0, range.r1, range.c0, range.c1].every(Number.isInteger) || range.r0 < 0 || range.r1 <= range.r0 || range.c0 < 0 || range.c1 <= range.c0) continue;
          chartCount++;
          const chartName = `chart${chartCount}`;
          const chartRelId = `rId${drawingRels.length + 1}`;
          drawingRels.push(`<Relationship Id="${chartRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/${chartName}.xml"/>`);
          // Posição: a mesma que na folha (ou ao lado dos dados nos ficheiros antigos).
          const fromX = colAtX(Number.isFinite(chart.x) ? chart.x : 46 + (range.c1 + 1) * 104 + 24);
          const fromY = rowAtY(Number.isFinite(chart.y) ? chart.y : 26 + range.r0 * 26);
          const toX = colAtX((Number.isFinite(chart.x) ? chart.x : 46 + (range.c1 + 1) * 104 + 24) + (chart.w || 520));
          const toY = rowAtY((Number.isFinite(chart.y) ? chart.y : 26 + range.r0 * 26) + (chart.h || 320));
          const sheetRef = `'${safeName.replace(/'/g, "''")}'!`;
          const colRef = (c) => `${sheetRef}$${F.colName(c)}$${range.r0 + 2}:$${F.colName(c)}$${range.r1 + 1}`;
          const ax1 = chartCount * 10 + 1, ax2 = chartCount * 10 + 2;
          const pie = kind === 'pie' || kind === 'doughnut';
          const lastCol = pie ? range.c0 + 1 : range.c1;
          const sers = [];
          const palette = (MO.Charts && MO.Charts.PALETTES[chart.palette] ? MO.Charts.PALETTES[chart.palette] : { colors: ['#16865b', '#2f6fdd', '#e47758', '#c79a1e', '#8a5cd1', '#1aa3a3', '#d14d72', '#6b7a72'] }).colors.map((c) => c.slice(1).toUpperCase());
          const fill = (k) => `<a:solidFill><a:srgbClr val="${palette[k % palette.length]}"/></a:solidFill>`;
          // Valores guardados no próprio gráfico, para quem não recalcula.
          const cellVal = (r, c) => { const v = sheet.values && sheet.values.get ? sheet.values.get(F.addr(r, c)) : undefined; return v != null && typeof v !== 'object' ? v : sheet.cells?.[F.addr(r, c)]?.v ?? ''; };
          const nPts = range.r1 - range.r0;
          const strCache = (c) => `<c:strCache><c:ptCount val="${nPts}"/>${Array.from({ length: nPts }, (_x, i) => `<c:pt idx="${i}"><c:v>${esc(String(cellVal(range.r0 + 1 + i, c)))}</c:v></c:pt>`).join('')}</c:strCache>`;
          const numCache = (c) => `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${nPts}"/>${Array.from({ length: nPts }, (_x, i) => { const v = Number(cellVal(range.r0 + 1 + i, c)); return Number.isFinite(v) && String(cellVal(range.r0 + 1 + i, c)) !== '' ? `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>` : ''; }).join('')}</c:numCache>`;
          for (let c = range.c0 + 1, k = 0; c <= lastCol; c++, k++) {
            const name = String(sheet.cells?.[F.addr(range.r0, c)]?.v || `Série ${k + 1}`);
            const tx = `<c:tx><c:strRef><c:f>${esc(`${sheetRef}$${F.colName(c)}$${range.r0 + 1}`)}</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${esc(name)}</c:v></c:pt></c:strCache></c:strRef></c:tx>`;
            const cat = kind === 'scatter' ? `<c:xVal><c:numRef><c:f>${esc(colRef(range.c0))}</c:f>${numCache(range.c0)}</c:numRef></c:xVal>` : `<c:cat><c:strRef><c:f>${esc(colRef(range.c0))}</c:f>${strCache(range.c0)}</c:strRef></c:cat>`;
            const val = kind === 'scatter' ? `<c:yVal><c:numRef><c:f>${esc(colRef(c))}</c:f>${numCache(c)}</c:numRef></c:yVal>` : `<c:val><c:numRef><c:f>${esc(colRef(c))}</c:f>${numCache(c)}</c:numRef></c:val>`;
            const marker = (size) => `<c:marker><c:symbol val="circle"/><c:size val="${size}"/><c:spPr>${fill(k)}<a:ln><a:noFill/></a:ln></c:spPr></c:marker>`;
            const points = pie ? Array.from({ length: nPts }, (_x, i) => `<c:dPt><c:idx val="${i}"/><c:bubble3D val="0"/><c:spPr>${fill(i)}<a:ln w="19050"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:dPt>`).join('') : '';
            const extra = kind === 'scatter' ? `<c:spPr><a:ln w="19050"><a:noFill/></a:ln></c:spPr>${marker(7)}`
              : kind === 'line' ? `<c:spPr><a:ln w="28575" cap="rnd">${fill(k)}<a:round/></a:ln></c:spPr>${marker(6)}`
              : kind === 'area' ? `<c:spPr><a:solidFill><a:srgbClr val="${palette[k % palette.length]}"><a:alpha val="45000"/></a:srgbClr></a:solidFill><a:ln w="22225">${fill(k)}</a:ln></c:spPr>`
              : pie ? points
              : `<c:spPr>${fill(k)}</c:spPr><c:invertIfNegative val="0"/>`;
            sers.push(`<c:ser><c:idx val="${k}"/><c:order val="${k}"/>${tx}${extra}${cat}${val}${kind === 'line' || kind === 'scatter' ? '<c:smooth val="0"/>' : ''}</c:ser>`);
          }
          const labels = chart.labels ? `<c:dLbls><c:showLegendKey val="0"/><c:showVal val="${pie ? 0 : 1}"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="${pie ? 1 : 0}"/><c:showBubbleSize val="0"/></c:dLbls>` : '';
          const axes = `<c:axId val="${ax1}"/><c:axId val="${ax2}"/>`;
          let plot;
          if (kind === 'line') plot = `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${sers.join('')}${labels}<c:marker val="1"/>${axes}</c:lineChart>`;
          else if (kind === 'area') plot = `<c:areaChart><c:grouping val="standard"/><c:varyColors val="0"/>${sers.join('')}${labels}${axes}</c:areaChart>`;
          else if (kind === 'pie') plot = `<c:pieChart><c:varyColors val="1"/>${sers.join('')}${labels}<c:firstSliceAng val="0"/></c:pieChart>`;
          else if (kind === 'doughnut') plot = `<c:doughnutChart><c:varyColors val="1"/>${sers.join('')}${labels}<c:firstSliceAng val="0"/><c:holeSize val="55"/></c:doughnutChart>`;
          else if (kind === 'scatter') plot = `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>${sers.join('')}${labels}${axes}</c:scatterChart>`;
          else plot = `<c:barChart><c:barDir val="${kind === 'bar' ? 'bar' : 'col'}"/><c:grouping val="${kind === 'stacked' ? 'stacked' : 'clustered'}"/><c:varyColors val="0"/>${sers.join('')}${labels}<c:gapWidth val="150"/>${kind === 'stacked' ? '<c:overlap val="100"/>' : ''}${axes}</c:barChart>`;
          const catAxis = kind === 'scatter'
            ? `<c:valAx><c:axId val="${ax1}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="1"/><c:tickLblPos val="nextTo"/><c:crossAx val="${ax2}"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx>`
            : `<c:catAx><c:axId val="${ax1}"/><c:scaling><c:orientation val="${kind === 'bar' ? 'maxMin' : 'minMax'}"/></c:scaling><c:delete val="0"/><c:axPos val="${kind === 'bar' ? 'l' : 'b'}"/><c:tickLblPos val="nextTo"/><c:crossAx val="${ax2}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx>`;
          const valAxis = `<c:valAx><c:axId val="${ax2}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${kind === 'bar' ? 'b' : 'l'}"/><c:majorGridlines/><c:numFmt formatCode="General" sourceLinked="1"/><c:tickLblPos val="nextTo"/><c:crossAx val="${ax1}"/><c:crosses val="${kind === 'bar' ? 'max' : 'autoZero'}"/><c:crossBetween val="between"/></c:valAx>`;
          const title = chart.title ? `<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>${esc(String(chart.title).slice(0, 120))}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>` : '<c:autoTitleDeleted val="1"/>';
          const legend = chart.legend !== false && (pie || sers.length > 1) ? '<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>' : '';
          chartFiles[`xl/charts/${chartName}.xml`] = XML_HEAD + `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:lang val="pt-PT"/><c:chart>${title}<c:plotArea><c:layout/>${plot}${pie ? '' : catAxis + valAxis}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`;
          chartOverrides.push(`<Override PartName="/xl/charts/${chartName}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
          frames.push(`<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${fromX.col}</xdr:col><xdr:colOff>${fromX.off}</xdr:colOff><xdr:row>${fromY.row}</xdr:row><xdr:rowOff>${fromY.off}</xdr:rowOff></xdr:from><xdr:to><xdr:col>${toX.col}</xdr:col><xdr:colOff>${toX.off}</xdr:colOff><xdr:row>${toY.row}</xdr:row><xdr:rowOff>${toY.off}</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${chartCount + 1}" name="${esc(chart.name || `Gráfico ${chartCount}`)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${chartRelId}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`);
        }
        if (frames.length) {
          drawingTag = '<drawing r:id="rId1"/>';
          drawingFiles[`xl/drawings/${drawingName}.xml`] = XML_HEAD + `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${frames.join('')}</xdr:wsDr>`;
          drawingOverrides.push(`<Override PartName="/xl/drawings/${drawingName}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
          drawingFiles[`xl/drawings/_rels/${drawingName}.xml.rels`] = XML_HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${drawingRels.join('')}</Relationships>`;
          sheetFiles[`xl/worksheets/_rels/sheet${i + 1}.xml.rels`] = XML_HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/${drawingName}.xml"/></Relationships>`;
        }
      }
      sheetFiles[`xl/worksheets/sheet${i + 1}.xml`] = XML_HEAD + `<worksheet ${NS} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${sheetView(sheet.freeze)}<sheetFormatPr defaultRowHeight="15"/>${colsXML(sheet.widths)}<sheetData>${rowsXML}</sheetData>${mergeXML(sheet.merges)}${rulesXML(sheet.rules)}${drawingTag}</worksheet>`;
      sheetParts.push(`<sheet name="${esc(safeName)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`);
      sheetRels.push(`<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`);
      sheetOverrides.push(`<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
    }

    return zip({
      '[Content_Types].xml':
        XML_HEAD +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        sheetOverrides.join('') +
        chartOverrides.join('') +
        drawingOverrides.join('') +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
      '_rels/.rels':
        XML_HEAD +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      'xl/workbook.xml':
        XML_HEAD +
        `<workbook ${NS} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetParts.join('')}</sheets><calcPr fullCalcOnLoad="1"/></workbook>`,
      'xl/_rels/workbook.xml.rels':
        XML_HEAD +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRels.join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      'xl/styles.xml':
        XML_HEAD +
        `<styleSheet ${NS}><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;€&quot;"/></numFmts>` +
        `<fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills>` +
        `<borders count="${borders.length}">${borders.join('')}</borders>` +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>${dxfList.length ? `<dxfs count="${dxfList.length}">${dxfList.join('')}</dxfs>` : ''}</styleSheet>`,
      ...sheetFiles,
      ...drawingFiles,
      ...chartFiles
    });
  }

  // =====================================================================
  // PPTX
  // =====================================================================

  const STAGE = { w: 960, h: 540 };
  const PH_DEFAULT = {
    ctrTitle: { x: 80, y: 170, w: 800, h: 110, fs: 54 },
    subTitle: { x: 80, y: 300, w: 800, h: 60, fs: 28 },
    title: { x: 60, y: 40, w: 840, h: 80, fs: 40 },
    body: { x: 60, y: 140, w: 840, h: 340, fs: 28 }
  };

  function importPptx(bytes) {
    const files = unzip(bytes);
    const pres = parseXML(files, 'ppt/presentation.xml');
    if (!pres) throw new Error('Apresentação inválida');
    const presRels = relsOf(files, 'ppt/presentation.xml');
    const size = first(pres, 'sldSz');
    const cx = Number(attr(size, 'cx')) || 9144000;
    const cy = Number(attr(size, 'cy')) || 5143500;
    // Ajusta o diapositivo à área 960 × 540, centrando quando a proporção é diferente (por exemplo 4:3).
    const k = Math.min(STAGE.w / cx, STAGE.h / cy);
    const dx = (STAGE.w - cx * k) / 2;
    const dy = (STAGE.h - cy * k) / 2;
    const ptToPx = k * 12700; // 1 pt = 12700 EMU

    const boxOf = (xfrm) => {
      const off = kid(xfrm, 'off');
      const ext = kid(xfrm, 'ext');
      if (!off || !ext) return null;
      return { x: Math.round(Number(attr(off, 'x')) * k + dx), y: Math.round(Number(attr(off, 'y')) * k + dy), w: Math.round(Number(attr(ext, 'cx')) * k), h: Math.round(Number(attr(ext, 'cy')) * k) };
    };
    // Cores do tema (schemeClr) e ajustes de luminosidade (lumMod/lumOff), como o PowerPoint usa.
    let scheme = {};
    function loadScheme(masterPath) {
      scheme = {};
      const themeRel = masterPath && Object.values(relsOf(files, masterPath)).find((r) => r.type === 'theme');
      const themeDoc = themeRel && parseXML(files, themeRel.path);
      for (const node of kids(first(themeDoc, 'clrScheme'))) {
        const value = attr(kid(node, 'srgbClr'), 'val') || attr(kid(node, 'sysClr'), 'lastClr');
        if (value && /^[0-9a-f]{6}$/i.test(value)) scheme[node.localName] = value.toLowerCase();
      }
    }
    const ALIAS = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
    function adjust(hex, colorNode) {
      const mod = Number(attr(kid(colorNode, 'lumMod'), 'val'));
      const off = Number(attr(kid(colorNode, 'lumOff'), 'val'));
      if (!mod && !off) return hex;
      let [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      let hue = 0, sat = 0, lum = (max + min) / 2;
      if (max !== min) {
        const d = max - min;
        sat = lum > 0.5 ? d / (2 - max - min) : d / (max + min);
        hue = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
        hue /= 6;
      }
      lum = Math.max(0, Math.min(1, lum * (mod ? mod / 100000 : 1) + (off ? off / 100000 : 0)));
      const q = lum < 0.5 ? lum * (1 + sat) : lum + sat - lum * sat;
      const p = 2 * lum - q;
      const ch = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
      [r, g, b] = sat ? [ch(hue + 1 / 3), ch(hue), ch(hue - 1 / 3)] : [lum, lum, lum];
      return [r, g, b].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
    }
    const colorOf = (fill) => {
      const rgb = kid(fill, 'srgbClr');
      if (rgb && /^[0-9a-f]{6}$/i.test(attr(rgb, 'val') || '')) return '#' + adjust(attr(rgb, 'val').toLowerCase(), rgb);
      const sc = kid(fill, 'schemeClr');
      const base = sc && scheme[ALIAS[attr(sc, 'val')] || attr(sc, 'val')];
      return base ? '#' + adjust(base, sc) : null;
    };
    const solid = (node) => colorOf(kid(node, 'solidFill'));

    // Posição de um marcador de posição herdada do esquema ou do modelo global.
    function inheritedBox(doc, type, idx) {
      for (const sp of all(doc, 'sp')) {
        const ph = first(kid(sp, 'nvSpPr'), 'ph');
        if (!ph) continue;
        const sameType = (attr(ph, 'type') || 'body') === type;
        if ((idx && attr(ph, 'idx') === idx) || (!idx && sameType) || (sameType && type !== 'body')) {
          const box = boxOf(first(kid(sp, 'spPr'), 'xfrm'));
          if (box) return box;
        }
      }
      return null;
    }

    function paragraphs(txBody, defaults) {
      const paras = kids(txBody, 'p');
      let size = null;
      let color = null;
      let bold = null;
      let italic = null;
      let align = null;
      let bulleted = false;
      const lines = paras.map((p) => {
        const pPr = kid(p, 'pPr');
        if (!align) align = { ctr: 'center', r: 'right' }[attr(pPr, 'algn')] || null;
        if (pPr && (kid(pPr, 'buChar') || kid(pPr, 'buAutoNum'))) bulleted = true;
        let out = '';
        for (const node of p.children) {
          if (node.localName === 'br') out += '<br>';
          if (node.localName !== 'r' && node.localName !== 'fld') continue;
          const rPr = kid(node, 'rPr');
          const text = html(first(node, 't') ? first(node, 't').textContent : '');
          if (!text) continue;
          const b = attr(rPr, 'b') === '1';
          const i = attr(rPr, 'i') === '1';
          if (size === null && attr(rPr, 'sz')) size = Number(attr(rPr, 'sz')) / 100;
          if (color === null) color = rPr ? solid(rPr) : null;
          if (bold === null) bold = b;
          if (italic === null) italic = i;
          out += (b && !defaults.bold ? `<b>${text}</b>` : text).replace(/^(.*)$/s, i ? '<i>$1</i>' : '$1');
        }
        return { text: out, noBullet: Boolean(pPr && kid(pPr, 'buNone')) };
      });
      const filled = lines.filter((l) => l.text);
      if (!filled.length) return null;
      const asList = (defaults.list || bulleted) && !filled.every((l) => l.noBullet);
      return {
        html: asList ? '<ul>' + filled.map((l) => `<li>${l.text}</li>`).join('') + '</ul>' : filled.map((l) => l.text).join('<br>'),
        fs: Math.max(8, Math.min(200, Math.round(size ? size * ptToPx : defaults.fs))),
        color,
        align,
        italic: Boolean(italic) && filled.length === 1
      };
    }

    const slides = [];
    for (const sldId of all(first(pres, 'sldIdLst'), 'sldId')) {
      const rel = presRels[relAttr(sldId)];
      const doc = rel && parseXML(files, rel.path);
      if (!doc) continue;
      const rels = relsOf(files, rel.path);
      const layoutRel = Object.values(rels).find((r) => r.type === 'slideLayout');
      const layout = layoutRel && parseXML(files, layoutRel.path);
      const masterRel = layoutRel && Object.values(relsOf(files, layoutRel.path)).find((r) => r.type === 'slideMaster');
      const master = masterRel && parseXML(files, masterRel.path);
      loadScheme(masterRel && masterRel.path);
      const els = [];

      const visit = (tree) => {
        for (const node of kids(tree)) {
          if (node.localName === 'grpSp') visit(node);
          else if (node.localName === 'graphicFrame' && first(node, 'tbl')) {
            // Tabela: o texto de cada célula; a cor do cabeçalho vem do preenchimento da primeira linha.
            const box = boxOf(kid(node, 'xfrm'));
            const trs = kids(first(node, 'tbl'), 'tr').slice(0, 20);
            if (!box || !trs.length) continue;
            const rows = trs.map((tr) => kids(tr, 'tc').slice(0, 10).map((tc) => kids(kid(tc, 'txBody'), 'p').map((p) => all(p, 't').map((t) => t.textContent).join('')).join(' ').trim().slice(0, 500)));
            const firstCell = kids(trs[0], 'tc')[0];
            const accent = solid(kid(firstCell, 'tcPr')) || (scheme.accent1 ? '#' + scheme.accent1 : '#1f5fbf');
            const sz = Number(attr(first(node, 'rPr'), 'sz'));
            els.push({ type: 'table', ...box, rows, fs: Math.max(8, Math.min(72, Math.round(sz ? (sz / 100) * ptToPx : 18))), accent });
          }
          else if (node.localName === 'pic') {
            const blipRel = rels[attr(first(node, 'blip'), 'embed')];
            const src = blipRel && imageDataURL(files, blipRel.path);
            const box = boxOf(first(kid(node, 'spPr'), 'xfrm'));
            if (src && box) els.push({ type: 'image', src, pptId: attr(first(kid(node, 'nvPicPr'), 'cNvPr'), 'id'), ...box });
          } else if (node.localName === 'sp') {
            const ph = first(kid(node, 'nvSpPr'), 'ph');
            const type = ph ? attr(ph, 'type') || 'body' : null;
            if (['dt', 'ftr', 'sldNum', 'hdr'].includes(type)) continue;
            const spPr = kid(node, 'spPr');
            const preset = ph ? PH_DEFAULT[type] || PH_DEFAULT.body : null;
            const box =
              boxOf(first(spPr, 'xfrm')) ||
              (ph && (inheritedBox(layout, type, attr(ph, 'idx')) || inheritedBox(master, type, attr(ph, 'idx')))) ||
              (preset && { x: preset.x, y: preset.y, w: preset.w, h: preset.h });
            if (!box) continue;
            const fill = solid(spPr);
            const geometry = attr(kid(spPr, 'prstGeom'), 'prst');
            if (fill && !ph) els.push({ type: geometry === 'ellipse' ? 'ellipse' : 'rect', fill, pptId: attr(first(kid(node, 'nvSpPr'), 'cNvPr'), 'id'), ...box });
            const isTitle = type === 'title' || type === 'ctrTitle';
            const text = paragraphs(kid(node, 'txBody'), { fs: preset ? preset.fs : 24, list: type === 'body', bold: isTitle });
            if (!text) continue;
            const el = { type: 'text', pptId: attr(first(kid(node, 'nvSpPr'), 'cNvPr'), 'id'), ...box, html: text.html, fs: text.fs, color: text.color || (isTitle ? '#1c2130' : '#3b4252'), align: text.align || (type === 'ctrTitle' || type === 'subTitle' ? 'center' : 'left') };
            if (isTitle) Object.assign(el, { bold: true, role: 'title' });
            else if (ph) el.role = 'body';
            if (text.italic) el.italic = true;
            els.push(el);
          }
        }
      };
      visit(first(doc, 'spTree'));

      for (const effect of all(doc, 'animEffect')) {
        const targetId = attr(first(effect, 'spTgt'), 'spid');
        const target = els.find((el) => el.pptId === targetId);
        if (target) target.animation = (attr(effect, 'filter') || '').startsWith('zoom') ? 'zoom' : 'fade';
      }

      const transition = first(doc, 'transition');
      const transitionKind = transition && kids(transition).find((node) => ['fade', 'push', 'wipe'].includes(node.localName));
      // Fundo: cor (também do tema) ou imagem, que passa a ser uma imagem por trás de tudo.
      const bgPr = first(kid(first(doc, 'cSld'), 'bg'), 'bgPr');
      const bgBlip = first(kid(bgPr, 'blipFill'), 'blip');
      const bgSrc = bgBlip && rels[attr(bgBlip, 'embed')] && imageDataURL(files, rels[attr(bgBlip, 'embed')].path);
      if (bgSrc) els.unshift({ type: 'image', src: bgSrc, x: Math.round(dx), y: Math.round(dy), w: Math.round(cx * k), h: Math.round(cy * k) });
      const slide = { bg: solid(bgPr) || '#ffffff', els, notes: '', transition: transitionKind ? transitionKind.localName : '' };
      const notesRel = Object.values(rels).find((r) => r.type === 'notesSlide');
      const notes = notesRel && parseXML(files, notesRel.path);
      for (const sp of all(notes, 'sp')) {
        if (attr(first(kid(sp, 'nvSpPr'), 'ph'), 'type') !== 'body') continue;
        slide.notes = kids(kid(sp, 'txBody'), 'p')
          .map((p) => all(p, 't').map((t) => t.textContent).join(''))
          .join('\n')
          .trim();
      }
      slides.push(slide);
    }
    if (!slides.length) throw new Error('Sem diapositivos');
    return slides;
  }

  // slides: modelo dos Diapositivos; fonts: mapa chave -> família de tipos de letra.
  function exportPptx(slides, fonts) {
    const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
    const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
    const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
    const parts = {};
    let mediaCount = 0;
    const emu = (px) => Math.round(px * EMU);
    const xfrm = (el) => `<a:xfrm><a:off x="${emu(el.x)}" y="${emu(el.y)}"/><a:ext cx="${emu(el.w)}" cy="${emu(el.h)}"/></a:xfrm>`;
    const fill = (color) => `<a:solidFill><a:srgbClr val="${(hexColor(color) || '000000').toUpperCase()}"/></a:solidFill>`;

    function textBody(el, slide) {
      const face = esc(fontName(fonts[el.role === 'title' && slide.headFont ? slide.headFont : slide.font] || fonts.sans));
      const size = Math.max(100, Math.round(el.fs * 75)); // px -> centésimos de ponto
      const holder = document.createElement('div');
      holder.innerHTML = el.html;

      function runs(node, fmt) {
        let out = '';
        for (const child of node.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) {
            if (!child.nodeValue) continue;
            out += `<a:r><a:rPr lang="pt-PT" sz="${size}" b="${fmt.b ? 1 : 0}" i="${fmt.i ? 1 : 0}"${fmt.u ? ' u="sng"' : ''} dirty="0">${fill(el.color)}<a:latin typeface="${face}"/><a:cs typeface="${face}"/></a:rPr><a:t>${esc(child.nodeValue)}</a:t></a:r>`;
          } else if (child.nodeType === Node.ELEMENT_NODE) {
            if (child.tagName === 'BR') out += '<a:br/>';
            else if (!['UL', 'OL', 'LI', 'P', 'DIV'].includes(child.tagName)) {
              const st = child.style;
              out += runs(child, {
                b: fmt.b || ['B', 'STRONG'].includes(child.tagName) || st.fontWeight === 'bold' || Number(st.fontWeight) >= 600,
                i: fmt.i || ['I', 'EM'].includes(child.tagName) || st.fontStyle === 'italic',
                u: fmt.u || child.tagName === 'U' || (st.textDecorationLine || st.textDecoration || '').includes('underline')
              });
            }
          }
        }
        return out;
      }

      const base = { b: Boolean(el.bold), i: Boolean(el.italic), u: false };
      const algn = { center: 'ctr', right: 'r' }[el.align] || 'l';
      const paras = [];
      const walk = (node, bullet) => {
        let loose = document.createElement('span');
        const flush = () => {
          if (loose.childNodes.length) paras.push({ node: loose, bullet: false });
          loose = document.createElement('span');
        };
        for (const child of [...node.childNodes]) {
          const tag = child.nodeType === Node.ELEMENT_NODE ? child.tagName : '';
          if (tag === 'UL' || tag === 'OL') {
            flush();
            walk(child, true);
          } else if (tag === 'LI') paras.push({ node: child, bullet });
          else if (tag === 'P' || tag === 'DIV') {
            flush();
            paras.push({ node: child, bullet: false });
          } else if (tag === 'BR') flush();
          else loose.append(child.cloneNode(true));
        }
        flush();
      };
      walk(holder, false);
      const body = paras
        .map(({ node, bullet }) => {
          const pPr = bullet
            ? `<a:pPr marL="342900" indent="-342900" algn="${algn}"><a:buFont typeface="Arial"/><a:buChar char="&#8226;"/></a:pPr>`
            : `<a:pPr marL="0" indent="0" algn="${algn}"><a:buNone/></a:pPr>`;
          return `<a:p>${pPr}${runs(node, base)}</a:p>`;
        })
        .join('');
      return `<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>${body || '<a:p/>'}</p:txBody>`;
    }

    slides.forEach((slide, index) => {
      const n = index + 1;
      const rels = [`<Relationship Id="rId1" Type="${REL}slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`];
      let shapes = '';
      const animationNodes = [];
      let id = 1;
      for (const el of slide.els) {
        id++;
        const shapeId = id;
        if (el.type === 'text') {
          shapes += `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Texto ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(el)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>${textBody(el, slide)}</p:sp>`;
        } else if (el.type === 'image') {
          const data = imageBytes(el.src);
          if (!data) continue;
          mediaCount++;
          const name = `image${mediaCount}.${data.ext}`;
          parts['ppt/media/' + name] = data.bytes;
          rels.push(`<Relationship Id="rId${rels.length + 1}" Type="${REL}image" Target="../media/${name}"/>`);
          shapes += `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Imagem ${id}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId${rels.length}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(el)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
        } else if (el.type === 'table') {
          // Tabela nativa do PowerPoint: cabeçalho na cor de destaque e linhas alternadas.
          const rows = Array.isArray(el.rows) ? el.rows : [];
          const cols = rows[0] ? rows[0].length : 0;
          if (!rows.length || !cols) continue;
          const colW = Math.round((el.w * EMU) / cols);
          const rowH = Math.round((el.h * EMU) / rows.length);
          const size = Math.max(800, Math.round(el.fs * 75));
          const cell = (text, header, odd) => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="pt-PT" sz="${size}" b="${header ? 1 : 0}" dirty="0">${fill(header ? '#ffffff' : '#1c2130')}</a:rPr><a:t>${esc(text)}</a:t></a:r></a:p></a:txBody><a:tcPr>${fill(header ? el.accent || '#1f5fbf' : odd ? '#f3f6fa' : '#ffffff')}</a:tcPr></a:tc>`;
          shapes += `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Tabela ${id}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>` +
            `<p:xfrm><a:off x="${emu(el.x)}" y="${emu(el.y)}"/><a:ext cx="${emu(el.w)}" cy="${emu(el.h)}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/>` +
            `<a:tblGrid>${Array(cols).fill(`<a:gridCol w="${colW}"/>`).join('')}</a:tblGrid>` +
            rows.map((row, r) => `<a:tr h="${rowH}">${row.map((text) => cell(text, r === 0, r % 2 === 1)).join('')}</a:tr>`).join('') +
            '</a:tbl></a:graphicData></a:graphic></p:graphicFrame>';
        } else {
          shapes += `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Forma ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(el)}<a:prstGeom prst="${el.type === 'ellipse' ? 'ellipse' : 'rect'}"><a:avLst/></a:prstGeom>${fill(el.fill)}<a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="pt-PT"/></a:p></p:txBody></p:sp>`;
        }
        if (['fade', 'zoom', 'appear'].includes(el.animation)) {
          const seq = animationNodes.length;
          const effect = el.animation === 'zoom' ? 'zoom' : 'fade';
          animationNodes.push(`<p:par><p:cTn id="${100 + seq * 2}" fill="hold"><p:stCondLst><p:cond delay="${seq * 120}"/></p:stCondLst><p:childTnLst><p:animEffect transition="in" filter="${effect}"><p:cBhvr><p:cTn id="${101 + seq * 2}" dur="450" fill="hold"/><p:tgtEl><p:spTgt spid="${shapeId}"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr></p:animEffect></p:childTnLst></p:cTn></p:par>`);
        }
      }
      const timing = animationNodes.length ? `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${animationNodes.join('')}</p:childTnLst></p:cTn></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>` : '';
      parts[`ppt/slides/slide${n}.xml`] =
        XML_HEAD +
        `<p:sld ${A} ${R} ${P}><p:cSld><p:bg><p:bgPr>${fill(slide.bg)}<a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
        `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes}</p:spTree></p:cSld>${['fade', 'push', 'wipe'].includes(slide.transition) ? `<p:transition spd="med" advClick="1"><p:${slide.transition}${slide.transition === 'push' || slide.transition === 'wipe' ? ' dir="l"' : ''}/></p:transition>` : ''}${timing}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
      parts[`ppt/slides/_rels/slide${n}.xml.rels`] = XML_HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`;
    });

    const emptyTree = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>';
    const line = '<a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>';
    const scheme = (name, value) => `<a:${name}><a:srgbClr val="${value}"/></a:${name}>`;
    const list = slides.map((_s, i) => i + 1);

    return zip({
      '[Content_Types].xml':
        XML_HEAD +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/>' +
        '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
        '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
        '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
        '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
        list.map((n) => `<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('') +
        '</Types>',
      '_rels/.rels': XML_HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
      'ppt/presentation.xml':
        XML_HEAD +
        `<p:presentation ${A} ${R} ${P}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${list.map((n) => `<p:sldId id="${255 + n}" r:id="rId${n + 2}"/>`).join('')}</p:sldIdLst>` +
        '<p:sldSz cx="9144000" cy="5143500"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>',
      'ppt/_rels/presentation.xml.rels':
        XML_HEAD +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="${REL}theme" Target="theme/theme1.xml"/>` +
        list.map((n) => `<Relationship Id="rId${n + 2}" Type="${REL}slide" Target="slides/slide${n}.xml"/>`).join('') +
        '</Relationships>',
      'ppt/slideMasters/slideMaster1.xml':
        XML_HEAD +
        `<p:sldMaster ${A} ${R} ${P}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>${emptyTree}</p:cSld>` +
        '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
        '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>',
      'ppt/slideMasters/_rels/slideMaster1.xml.rels':
        XML_HEAD +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${REL}theme" Target="../theme/theme1.xml"/></Relationships>`,
      'ppt/slideLayouts/slideLayout1.xml': XML_HEAD + `<p:sldLayout ${A} ${R} ${P} type="blank" preserve="1"><p:cSld name="Em branco">${emptyTree}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
      'ppt/slideLayouts/_rels/slideLayout1.xml.rels':
        XML_HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
      'ppt/theme/theme1.xml':
        XML_HEAD +
        `<a:theme ${A} name="Tema"><a:themeElements><a:clrScheme name="Tema">` +
        '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
        scheme('dk2', '1C2130') + scheme('lt2', 'F3F2F1') + scheme('accent1', '1F5FBF') + scheme('accent2', 'C8491F') + scheme('accent3', '7A7F8C') +
        scheme('accent4', 'E0A800') + scheme('accent5', '3B8ED0') + scheme('accent6', '4E9A3A') + scheme('hlink', '1F5FBF') + scheme('folHlink', '7A1F3D') +
        '</a:clrScheme><a:fontScheme name="Tema"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
        '<a:fmtScheme name="Tema"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>' +
        `<a:lnStyleLst>${line}${line}${line}</a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>` +
        '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>',
      ...parts
    });
  }

  MO.OOXML = { importDocx, exportDocx, importXlsx, exportXlsx, importPptx, exportPptx };
})();
